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
    # brevo additionally accepts the platform BREVO_API_KEY — the same
    # resolution the worker's brevoSend uses, so send capability == status.
    import os
    env_val = os.environ.get(f"CONN_{connector_id.upper()}")
    if not env_val and connector_id == "brevo":
        env_val = os.environ.get("BREVO_API_KEY")
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
    # cred: "<access_token>" or "<access_token>:<numeric_org_id>" — the author
    # URN needs the org's numeric id; bare "lazynext" is a best-effort default
    # LinkedIn may reject (invalid URN → 4xx).
    token, _, org = cred.partition(":")
    return await _post(
        "https://api.linkedin.com/v2/ugcPosts",
        headers={"authorization": f"Bearer {token}"},
        json_body={
            "author": f"urn:li:organization:{org or 'lazynext'}",
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

async def _brevo(payload: dict, cred: str) -> dict:
    # cred format: "<sender_email>:<api_key>" — a bare key falls back to
    # support@lazynext.com as the verified sender. Key from brevo.com →
    # SMTP & API → API Keys (free tier: 300 emails/day).
    i = cred.rfind(":")
    maybe_from = cred[:i] if i > 0 else ""
    if "@" in maybe_from:
        frm, key = maybe_from, cred[i + 1:]
    else:
        frm, key = "support@lazynext.com", cred
    to = payload.get("to") or payload.get("email") or ""
    return await _post(
        "https://api.brevo.com/v3/smtp/email",
        headers={"api-key": key},
        json_body={
            "sender": {"email": frm, "name": "Lazynext"},
            "to": [{"email": to}],
            "subject": payload.get("subject", "Lazynext"),
            "htmlContent": payload.get("html", payload.get("text", "")),
        },
    )


# --- Scheduling & signing -------------------------------------------------

async def _signwell(payload: dict, cred: str) -> dict:
    # cred: bare SignWell API key (signwell.com/app → Settings → API). The free
    # plan includes a legal production API — 25 docs/month free. Prefix "test:"
    # for unlimited test-mode sends (not legally binding, no quota used).
    test = cred.startswith("test:")
    key = cred[5:] if test else cred
    template_id = payload.get("template_id")
    if not template_id:
        return {"ok": False, "error": "signwell requires template_id — create a template at signwell.com/app first"}
    headers = {"X-Api-Key": key}
    # Recipients must carry the placeholder_name of a template placeholder —
    # fetch the template and map the signer to its first placeholder unless an
    # explicit placeholder_name was provided.
    placeholder = payload.get("placeholder_name")
    if not placeholder:
        async with httpx.AsyncClient(timeout=15.0) as client:
            t = await client.get(
                f"https://www.signwell.com/api/v1/document_templates/{template_id}/",
                headers=headers,
            )
        if t.status_code == 200:
            phs = t.json().get("placeholders") or []
            placeholder = phs[0].get("name") if phs else None
    return await _post(
        "https://www.signwell.com/api/v1/document_templates/documents/",
        headers=headers,
        json_body={
            "test_mode": test or bool(payload.get("test_mode")),
            "template_id": template_id,
            **({"subject": payload["subject"]} if payload.get("subject") else {}),
            "recipients": [{
                "id": str(payload.get("recipient_id", "1")),
                **({"placeholder_name": placeholder} if placeholder else {}),
                "name": payload.get("signer_name", payload.get("name", "")),
                "email": payload.get("signer_email", payload.get("email", "")),
            }],
        },
    )


_DISPATCH = {
    "x": _x, "linkedin": _linkedin, "meta": _meta,
    "twilio": _twilio, "whatsapp": _whatsapp,
    "brevo": _brevo,
    "signwell": _signwell,
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
