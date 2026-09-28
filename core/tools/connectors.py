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


async def _facebook(text: str, cred: str) -> dict:
    # cred: "<page_access_token>:<page_id>" — organic Page post (unpaid reach,
    # unlike meta which is the paid Ads API).
    token, _, page = cred.partition(":")
    if not page:
        return {"ok": False, "error": "conn:facebook must be '<page_access_token>:<page_id>'"}
    return await _post(
        f"https://graph.facebook.com/v19.0/{page}/feed",
        json_body={"message": text, "access_token": token},
    )


async def _instagram(payload: dict, cred: str) -> dict:
    # cred: "<access_token>:<ig_user_id>" — IG can only publish media:
    # payload needs {text: caption, image_url: <public https image>}.
    token, _, uid = cred.partition(":")
    image = payload.get("image_url") or ""
    if not uid or not image:
        return {"ok": False, "error": "instagram requires image_url in payload — IG has no text-only posts"}
    c = await _post(
        f"https://graph.facebook.com/v19.0/{uid}/media",
        json_body={"image_url": image, "caption": payload.get("text", ""), "access_token": token},
    )
    if not c.get("ok"):
        return c
    return await _post(
        f"https://graph.facebook.com/v19.0/{uid}/media_publish",
        json_body={"creation_id": (c.get("body") or {}).get("id"), "access_token": token},
    )


async def _threads(text: str, cred: str) -> dict:
    # cred: "<access_token>:<threads_user_id>" — create container, then publish.
    token, _, uid = cred.partition(":")
    if not uid:
        return {"ok": False, "error": "conn:threads must be '<access_token>:<threads_user_id>'"}
    c = await _post(
        f"https://graph.threads.net/v1.0/{uid}/threads",
        json_body={"media_type": "TEXT", "text": text, "access_token": token},
    )
    if not c.get("ok"):
        return c
    return await _post(
        f"https://graph.threads.net/v1.0/{uid}/threads_publish",
        json_body={"creation_id": (c.get("body") or {}).get("id"), "access_token": token},
    )


async def _bluesky(text: str, cred: str) -> dict:
    # cred: "<handle.bsky.social>:<app_password>" — session token then post.
    handle, _, app_pw = cred.partition(":")
    sess = await _post(
        "https://bsky.social/xrpc/com.atproto.server.createSession",
        json_body={"identifier": handle, "password": app_pw},
    )
    if not sess.get("ok"):
        return sess
    s = sess.get("body") or {}
    return await _post(
        "https://bsky.social/xrpc/com.atproto.repo.createRecord",
        headers={"authorization": f"Bearer {s.get('accessJwt')}"},
        json_body={
            "repo": s.get("did"), "collection": "app.bsky.feed.post",
            "record": {"$type": "app.bsky.feed.post", "text": text,
                       "createdAt": __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()},
        },
    )


async def _mastodon(text: str, cred: str) -> dict:
    # cred: "<instance_host>:<access_token>" — host without scheme.
    host, _, token = cred.partition(":")
    if not host or not token:
        return {"ok": False, "error": "conn:mastodon must be '<instance_host>:<access_token>'"}
    return await _post(
        f"https://{host}/api/v1/statuses",
        headers={"authorization": f"Bearer {token}"},
        json_body={"status": text, "visibility": "public"},
    )


async def _reddit(payload: dict, cred: str) -> dict:
    # cred: "<client_id>:<client_secret>:<username>:<password>:<subreddit>" —
    # script-app OAuth, then self-post. Payload 'to' overrides the subreddit,
    # 'body' overrides the post body (text is the title).
    parts = cred.split(":")
    if len(parts) < 5:
        return {"ok": False, "error": "conn:reddit must be '<client_id>:<client_secret>:<username>:<password>:<subreddit>'"}
    cid, secret, user, pw, sr = parts[0], parts[1], parts[2], parts[3], parts[4]
    tok = await _post(
        "https://www.reddit.com/api/v1/access_token",
        auth=(cid, secret),
        headers={"user-agent": "lazynext/1.0"},
        data={"grant_type": "password", "username": user, "password": pw},
    )
    if not tok.get("ok"):
        return tok
    at = (tok.get("body") or {}).get("access_token")
    return await _post(
        "https://oauth.reddit.com/api/submit",
        headers={"authorization": f"Bearer {at}", "user-agent": "lazynext/1.0"},
        data={
            "sr": payload.get("to") or sr,
            "title": (payload.get("text") or "")[:300],
            "text": payload.get("body") or payload.get("text") or "",
            "kind": "self", "api_type": "json",
        },
    )


async def _pinterest(payload: dict, cred: str) -> dict:
    # cred: "<access_token>:<board_id>" — link pin; attach {image_url} for an
    # image pin (pins display richer with media).
    token, _, board = cred.partition(":")
    if not board:
        return {"ok": False, "error": "conn:pinterest must be '<access_token>:<board_id>'"}
    body: dict[str, Any] = {
        "board_id": board,
        "title": (payload.get("text") or "")[:100],
        "description": payload.get("text") or "",
        "link": payload.get("link") or "https://checker.lazynext.com",
    }
    if payload.get("image_url"):
        body["media_source"] = {"source_type": "image_url", "url": payload["image_url"]}
    return await _post(
        "https://api.pinterest.com/v5/pins",
        headers={"authorization": f"Bearer {token}"},
        json_body=body,
    )


# --- Chat / messaging communities ----------------------------------------

async def _discord(text: str, cred: str) -> dict:
    # cred: full channel webhook URL — no app review needed.
    return await _post(cred, json_body={"content": text})


async def _slack(text: str, cred: str) -> dict:
    # cred: full incoming-webhook URL.
    return await _post(cred, json_body={"text": text})


async def _telegram(text: str, cred: str) -> dict:
    # cred: "<bot_token>:<chat_id>" — bot must be admin/member of the chat.
    token, _, chat = cred.partition(":")
    if not chat:
        return {"ok": False, "error": "conn:telegram must be '<bot_token>:<chat_id>'"}
    return await _post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json_body={"chat_id": chat, "text": text},
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
    "facebook": _facebook, "instagram": _instagram, "threads": _threads,
    "bluesky": _bluesky, "mastodon": _mastodon, "reddit": _reddit,
    "pinterest": _pinterest,
    "discord": _discord, "slack": _slack, "telegram": _telegram,
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
