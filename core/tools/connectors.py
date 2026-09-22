"""Connector library — situational third-party services.

Credentials are set in the dashboard (Settings → Connector library) and stored
in Cloudflare KV under `conn:<id>`. Each connector resolves its credential from
KV (falling back to a matching env var) and performs its canonical action.
Nothing is active until a credential is connected.
"""

from typing import Any

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


async def _credential(connector_id: str) -> str | None:
    """Resolve a connector credential: KV `conn:<id>` → env `CONN_<ID>`."""
    s = get_settings()
    # Env var fallback first (e.g. CONN_X), then the worker KV store.
    import os
    env_val = os.environ.get(f"CONN_{connector_id.upper()}")
    if env_val:
        return env_val
    if s.cloudflare_api_url and s.cloudflare_api_token:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(
                    f"{s.cloudflare_api_url.rstrip('/')}/kv/get",
                    headers={
                        "authorization": f"Bearer {s.cloudflare_api_token}",
                        "content-type": "application/json",
                    },
                    json={"key": f"conn:{connector_id}"},
                )
                if r.status_code == 200:
                    return r.json().get("value")
        except Exception as e:
            logger.error("connector_credential_lookup_failed", id=connector_id, error=str(e))
    return None


async def _post(url: str, *, headers: dict | None = None, json_body: Any = None,
                data: Any = None, auth: tuple | None = None) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(url, headers=headers, json=json_body, data=data, auth=auth)
        try:
            body = r.json()
        except Exception:
            body = {"raw": r.text[:500]}
        return {"status": r.status_code, "ok": r.status_code < 400, "body": body}


# --- Social posting -------------------------------------------------------

async def _x(text: str, cred: str) -> dict:
    return await _post(
        "https://api.twitter.com/2/tweets",
        headers={"authorization": f"Bearer {cred}"},
        json_body={"text": text},
    )


async def _linkedin(text: str, cred: str) -> dict:
    return await _post(
        "https://api.linkedin.com/v2/ugcPosts",
        headers={"authorization": f"Bearer {cred}"},
        json_body={
            "author": "urn:li:organization:lazynext",
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": text},
                    "shareMediaCategory": "NONE",
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        },
    )


async def _meta(text: str, cred: str) -> dict:
    # cred format: "<access_token>:<ad_account_id>"
    token, _, acct = cred.partition(":")
    return await _post(
        f"https://graph.facebook.com/v19.0/act_{acct}/ads",
        json_body={"name": text[:120], "access_token": token},
    )


# --- Sales CRM ------------------------------------------------------------

# --- Commerce -------------------------------------------------------------

# --- Phone / SMS ----------------------------------------------------------

async def _twilio(payload: dict, cred: str) -> dict:
    # cred format: "<account_sid>:<auth_token>:<from_number>"
    sid, token, frm = (cred.split(":", 2) + [""])[:3]
    return await _post(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
        auth=(sid, token),
        data={"To": payload.get("to", ""), "From": frm, "Body": payload.get("text", "")},
    )


async def _whatsapp(payload: dict, cred: str) -> dict:
    # cred format: "<access_token>:<phone_number_id>"
    token, _, pid = cred.partition(":")
    return await _post(
        f"https://graph.facebook.com/v19.0/{pid}/messages",
        headers={"authorization": f"Bearer {token}"},
        json_body={
            "messaging_product": "whatsapp",
            "to": payload.get("to", ""),
            "type": "text",
            "text": {"body": payload.get("text", "")},
        },
    )


# --- Support tickets ------------------------------------------------------

# --- Email marketing ------------------------------------------------------

async def _mailchimp(payload: dict, cred: str) -> dict:
    # cred format: "<api_key>:<list_id>" (api_key embeds the dc suffix)
    key, _, list_id = cred.partition(":")
    dc = key.split("-")[-1] if "-" in key else "us1"
    return await _post(
        f"https://{dc}.api.mailchimp.com/3.0/lists/{list_id}/members",
        auth=("lazynext", key),
        json_body={"email_address": payload.get("email", ""), "status": "subscribed"},
    )


async def _sendgrid(payload: dict, cred: str) -> dict:
    return await _post(
        "https://api.sendgrid.com/v3/marketing/contacts",
        headers={"authorization": f"Bearer {cred}"},
        json_body={"contacts": [{"email": payload.get("email", "")}]},
    )


# --- Scheduling & signing -------------------------------------------------

async def _docusign(payload: dict, cred: str) -> dict:
    # cred format: "<account_id>:<access_token>"
    acct, _, token = cred.partition(":")
    return await _post(
        f"https://demo.docusign.net/restapi/v2.1/accounts/{acct}/envelopes",
        headers={"authorization": f"Bearer {token}"},
        json_body=payload,
    )


_DISPATCH = {
    "x": _x, "linkedin": _linkedin, "meta": _meta,
    "twilio": _twilio, "whatsapp": _whatsapp,
    "mailchimp": _mailchimp, "sendgrid": _sendgrid,
    "docusign": _docusign,
}


async def call_connector(connector_id: str, payload: dict[str, Any] | str) -> dict[str, Any]:
    """Invoke a situational connector. Returns the service's response, or a
    structured error if the connector is unknown or has no credential set."""
    fn = _DISPATCH.get(connector_id)
    if not fn:
        return {"ok": False, "error": f"unknown connector '{connector_id}'"}
    cred = await _credential(connector_id)
    if not cred:
        return {"ok": False, "error": f"'{connector_id}' not connected — set it in Settings → Connector library"}
    try:
        result = await fn(payload, cred)
        logger.info("connector_called", id=connector_id, ok=result.get("ok"))
        return result
    except Exception as e:
        logger.error("connector_call_failed", id=connector_id, error=str(e))
        return {"ok": False, "error": str(e)}


async def connector_status() -> dict[str, bool]:
    """Map connector_id → connected? (for agent awareness / dashboards)."""
    out: dict[str, bool] = {}
    for cid in _DISPATCH:
        out[cid] = bool(await _credential(cid))
    return out
