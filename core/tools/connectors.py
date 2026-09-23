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

# --- Scheduling & signing -------------------------------------------------

async def _docuseal(payload: dict, cred: str) -> dict:
    # cred format: "<base_url>:<api_key>" — hosted https://api.docuseal.com or a
    # self-hosted instance. Open-source, legally binding (ESIGN/UETA/eIDAS).
    # Free API on self-host; hosted API needs Pro. If payload has template_id,
    # submits that template directly; otherwise builds one from doc_text first.
    base, _, key = cred.partition(":")
    base = base.rstrip("/")
    headers = {"X-Auth-Token": key, "content-type": "application/json"}
    signer = payload.get("signer_email", payload.get("email", ""))
    submitter = {"role": payload.get("role", "Signer"), "email": signer}
    if payload.get("signer_name"):
        submitter["name"] = payload["signer_name"]
    template_id = payload.get("template_id")
    if not template_id:
        tpl = await _post(
            f"{base}/templates/html",
            headers=headers,
            json_body={
                "name": payload.get("title", "Signature request"),
                "html": f"<h3>{payload.get('title', 'Signature request')}</h3>"
                        f"<p>{payload.get('doc_text', '')}</p>",
            },
        )
        if not tpl.get("ok"):
            return tpl
        template_id = tpl.get("body", {}).get("id")
        if not template_id:
            return {"ok": False, "error": "docuseal returned no template id", "body": tpl.get("body")}
    return await _post(
        f"{base}/submissions",
        headers=headers,
        json_body={
            "template_id": template_id,
            "send_email": True,
            "submitters": [submitter],
            **({"message": {"subject": payload["subject"], "body": payload["message"]}}
               if payload.get("subject") or payload.get("message") else {}),
        },
    )


async def _inkless(payload: dict, cred: str) -> dict:
    # cred = Inkless API key (free — email hello@useinkless.com to get one).
    # Legally binding (ESIGN/UETA) with audit trail + webhooks. Sends a
    # pre-created template to recipients: build the template once in their
    # webapp (app.useinkless.com/templates), then pass template_id here.
    headers = {"x-api-key": cred, "content-type": "application/json"}
    template_id = payload.get("template_id")
    if not template_id:
        return {"ok": False, "error": "inkless requires template_id — create the template in app.useinkless.com first"}
    return await _post(
        "https://api.useinkless.com/createFromTemplate",
        headers=headers,
        json_body={
            "templateId": template_id,
            "recipients": [{
                "email": payload.get("signer_email", payload.get("email", "")),
                "name": payload.get("signer_name", payload.get("name", "")),
            }],
        },
    )


_DISPATCH = {
    "x": _x, "linkedin": _linkedin, "meta": _meta,
    "twilio": _twilio, "whatsapp": _whatsapp,
    "docuseal": _docuseal, "inkless": _inkless,
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
