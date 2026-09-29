"""Connector library — situational third-party services.

Credentials are set in the dashboard (Settings → Connector library) and stored
in Cloudflare KV under `conn:<id>`. Each connector resolves its credential from
KV (falling back to a matching env var) and performs its canonical action.
Nothing is active until a credential is connected.
"""

import datetime
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
        "https://api.x.com/2/tweets",
        headers={"authorization": f"Bearer {cred}"},
        json_body={"text": text},
    )


async def _linkedin(text: str, cred: str) -> dict:
    # cred: "<access_token>" or "<access_token>:<author>" where author is a
    # full urn ("urn:li:person:x" from the OAuth flow, "urn:li:organization:x")
    # or a bare numeric org id.
    token, _, suffix = cred.partition(":")
    author = suffix if suffix.startswith("urn:") else f"urn:li:organization:{suffix or 'lazynext'}"
    # Posts API (the ugcPosts replacement) — versioned, requires the
    # Linkedin-Version pin + Rest.li protocol header.
    return await _post(
        "https://api.linkedin.com/rest/posts",
        headers={
            "authorization": f"Bearer {token}",
            "x-restli-protocol-version": "2.0.0", "linkedin-version": "202609",
        },
        json_body={
            "author": author,
            "commentary": text,
            "visibility": "PUBLIC",
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
        },
    )


async def _meta(text: str, cred: str) -> dict:
    # cred format: "<access_token>:<ad_account_id>"
    token, _, acct = cred.partition(":")
    return await _post(
        f"https://graph.facebook.com/v25.0/act_{acct}/ads",
        json_body={"name": text[:120], "access_token": token},
    )


async def _facebook(text: str, cred: str) -> dict:
    # cred: "<page_access_token>:<page_id>" — organic Page post (unpaid reach,
    # unlike meta which is the paid Ads API).
    token, _, page = cred.partition(":")
    if not page:
        return {"ok": False, "error": "conn:facebook must be '<page_access_token>:<page_id>'"}
    return await _post(
        f"https://graph.facebook.com/v25.0/{page}/feed",
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
        f"https://graph.facebook.com/v25.0/{uid}/media",
        json_body={"image_url": image, "caption": payload.get("text", ""), "access_token": token},
    )
    if not c.get("ok"):
        return c
    return await _post(
        f"https://graph.facebook.com/v25.0/{uid}/media_publish",
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
    # cred: "<access_token>:<board_id>" — every pin requires media, so
    # image_url is mandatory (a bare link pin 400s at Pinterest).
    token, _, board = cred.partition(":")
    if not board:
        return {"ok": False, "error": "conn:pinterest must be '<access_token>:<board_id>'"}
    if not payload.get("image_url"):
        return {"ok": False, "error": "pinterest requires image_url — every pin needs media_source"}
    return await _post(
        "https://api.pinterest.com/v5/pins",
        headers={"authorization": f"Bearer {token}"},
        json_body={
            "board_id": board,
            "title": (payload.get("text") or "")[:100],
            "description": payload.get("text") or "",
            "link": payload.get("link") or "https://checker.lazynext.com",
            "media_source": {"source_type": "image_url", "url": payload["image_url"]},
        },
    )


async def _vk(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<access_token>:<owner_id>" — vk.com/dev standalone app token;
    # owner_id negative for communities ('-123456' posts to the group wall),
    # positive for a user wall.
    token, _, owner = cred.partition(":")
    if not owner:
        return {"ok": False, "error": "conn:vk must be '<access_token>:<owner_id>'"}
    return await _post(
        "https://api.vk.com/method/wall.post",
        data={
            "access_token": token, "owner_id": owner,
            "message": payload.get("text") or "",
            "from_group": 1 if owner.startswith("-") else 0, "v": "5.199",
        },
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


async def _matrix(text: str, cred: str) -> dict:
    # cred: "<homeserver_base>|<room_id>|<access_token>" — room_id looks like
    # !abc:matrix.org, so '|' separates (the parts carry their own ':').
    hs, _, rest = cred.partition("|")
    room, _, tok = rest.partition("|")
    if not hs or not room or not tok:
        return {"ok": False, "error": "conn:matrix must be '<homeserver_base>|<room_id>|<access_token>'"}
    import time
    from urllib.parse import quote
    return await _post(
        f"{hs.rstrip('/')}/_matrix/client/v3/rooms/{quote(room, safe='')}/send/m.room.message/{int(time.time() * 1000)}",
        headers={"authorization": f"Bearer {tok}"},
        json_body={"msgtype": "m.text", "body": text},
    )


async def _teams(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: Power Automate Workflows webhook URL — Teams channel → ⋯ →
    # Workflows → "Post to a channel when a webhook request is received".
    # Office 365 connector webhooks (*.webhook.office.com) were retired
    # May-2026; the workflow trigger accepts the Adaptive Card envelope.
    if not cred.startswith("https://"):
        return {"ok": False, "error": "conn:teams must be a Power Automate webhook URL (*.api.powerplatform.com)"}
    return await _post(cred, json_body={
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "contentUrl": None,
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard", "version": "1.2",
                "body": [{"type": "TextBlock", "text": payload.get("text") or "", "wrap": True}],
            },
        }],
    })


async def _mattermost(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: full incoming-webhook URL — Mattermost → Integrations → Incoming
    # Webhooks (…/hooks/<id>). Payload 'username'/'icon_url' override sender.
    if not cred.startswith("https://"):
        return {"ok": False, "error": "conn:mattermost must be an https:// incoming-webhook URL"}
    body: dict[str, Any] = {"text": payload.get("text") or ""}
    for k in ("username", "icon_url"):
        if payload.get(k):
            body[k] = payload[k]
    return await _post(cred, json_body=body)


async def _zulip(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<base_url>|<bot_email>|<api_key>" — Zulip → Settings → Bots →
    # zuliprc (bot email + key). Payload 'to' = stream name, 'topic' = thread.
    base, _, rest = cred.partition("|")
    email, _, key = rest.partition("|")
    if not base or not email or not key:
        return {"ok": False, "error": "conn:zulip must be '<base_url>|<bot_email>|<api_key>'"}
    to = payload.get("to")
    if not to:
        return {"ok": False, "error": "zulip needs payload.to — the stream name"}
    return await _post(
        f"{base.rstrip('/')}/api/v1/messages",
        auth=(email, key),
        data={
            "type": "stream", "to": to,
            "topic": payload.get("topic") or "Lazynext",
            "content": payload.get("text") or "",
        },
    )


async def _viber(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<auth_token>" — partners.viber.com bot account token. Payload
    # 'broadcast_list' (≤300 subscribed user ids) → broadcast to all (needs
    # Viber approval); payload 'to' → send_message to one subscriber.
    sender = {"name": payload.get("sender") or "Lazynext"}
    bl = payload.get("broadcast_list")
    if bl:
        return await _post(
            "https://chatapi.viber.com/pa/broadcast_message",
            headers={"x-viber-auth-token": cred},
            json_body={"broadcast_list": bl, "min_api_version": 7,
                       "sender": sender, "type": "text", "text": payload.get("text") or ""},
        )
    return await _post(
        "https://chatapi.viber.com/pa/send_message",
        headers={"x-viber-auth-token": cred},
        json_body={"receiver": payload.get("to") or "", "min_api_version": 7,
                   "sender": sender, "type": "text", "text": payload.get("text") or "",
                   "tracking_data": "lazynext"},
    )


async def _line(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<channel_access_token>" — LINE Developers console → Messaging API
    # channel → issue a long-lived token. Broadcasts to every friend of the
    # Official Account.
    return await _post(
        "https://api.line.me/v2/bot/message/broadcast",
        headers={"authorization": f"Bearer {cred}"},
        json_body={"messages": [{"type": "text", "text": payload.get("text") or ""}]},
    )


# --- Dev publishing -------------------------------------------------------

async def _devto(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<api_key>" — dev.to → Settings → Extensions → DEV API Keys.
    # Payload 'title' overrides the default (first line); 'draft: true'
    # publishes silently for review instead of going live.
    text = payload.get("text") or ""
    return await _post(
        "https://dev.to/api/articles",
        headers={"api-key": cred},
        json_body={
            "article": {
                "title": payload.get("title") or text.split("\n")[0][:100],
                "body_markdown": text,
                "published": payload.get("draft") is not True,
                "tags": payload.get("tags") or ["webdev"],
            }
        },
    )


async def _hashnode(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<token>:<publication_id>" — hashnode.com → Account → Developer.
    token, _, pub = cred.partition(":")
    text = payload.get("text") or ""
    if not pub:
        return {"ok": False, "error": "conn:hashnode must be '<token>:<publication_id>'"}
    return await _post(
        "https://gql.hashnode.com/",
        headers={"authorization": token},
        json_body={
            "query": "mutation($input: PublishPostInput!) { publishPost(input: $input) { post { id url } } }",
            "variables": {
                "input": {
                    "title": payload.get("title") or text.split("\n")[0][:100],
                    "contentMarkdown": text,
                    "publicationId": pub,
                }
            },
        },
    )


async def _medium(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<integration_token>" — medium.com → Settings → Integration
    # tokens. Medium's API is officially unsupported (no new integrations)
    # but integration tokens still work — treat as best-effort.
    # /v1/me resolves the user id at call time so the cred stays one value.
    text = payload.get("text") or ""
    async with httpx.AsyncClient(timeout=15.0) as client:
        me = await client.get("https://api.medium.com/v1/me",
                              headers={"authorization": f"Bearer {cred}"})
    if me.status_code >= 400:
        return {"status": me.status_code, "ok": False, "body": me.json() if me.text else {}}
    uid = (me.json().get("data") or {}).get("id")
    if not uid:
        return {"ok": False, "error": "medium /v1/me returned no user id"}
    return await _post(
        f"https://api.medium.com/v1/users/{uid}/posts",
        headers={"authorization": f"Bearer {cred}"},
        json_body={
            "title": payload.get("title") or text.split("\n")[0][:100],
            "contentFormat": "markdown", "content": text,
            "publishStatus": "public",
        },
    )


async def _wordpress(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<site_base>|<username>|<app_password>" — '|' because site_base
    # carries its own ':' (https://…). App passwords: WP Admin → Users →
    # Profile → Application Passwords (needs WP ≥5.6).
    site, _, rest = cred.partition("|")
    user, _, app = rest.partition("|")
    text = payload.get("text") or ""
    if not site or not user or not app:
        return {"ok": False, "error": "conn:wordpress must be '<site_base>|<username>|<app_password>'"}
    return await _post(
        f"{site.rstrip('/')}/wp-json/wp/v2/posts",
        auth=(user, app),
        json_body={
            "title": payload.get("title") or text.split("\n")[0][:100],
            "content": text, "status": "publish",
        },
    )


async def _github(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<pat>" — posts a public gist; the same PAT powers repo ops.
    gh = {"authorization": f"Bearer {cred}", "accept": "application/vnd.github+json"}
    r = await _post(
        "https://api.github.com/gists",
        headers=gh,
        json_body={
            "public": True,
            "description": payload.get("title") or "Lazynext",
            "files": {"post.md": {"content": payload.get("text") or ""}},
        },
    )
    # PATs without the `gist` scope (repo-scoped tokens) fall back to
    # committing markdown to a public `lazynext-posts` repo on the token
    # owner's account — auto-created lazily on first publish.
    if r["ok"] or r["status"] not in (403, 404):
        return r
    return await _github_repo_post(payload, gh)


async def _github_repo_post(payload: dict, gh: dict) -> dict:
    import base64
    import time

    async with httpx.AsyncClient(timeout=20.0) as client:
        me = await client.get("https://api.github.com/user", headers=gh)
        if me.status_code != 200:
            return {"ok": False, "status": me.status_code,
                    "error": "no gist scope and /user lookup failed"}
        owner = me.json().get("login")
        repo = "lazynext-posts"
        path = f"posts/{int(time.time())}.md"
        url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
        body = {
            "message": payload.get("title") or "Lazynext post",
            "content": base64.b64encode((payload.get("text") or "").encode()).decode(),
        }
        r = await client.put(url, headers=gh, json=body)
        if r.status_code == 404:
            c = await client.post(
                "https://api.github.com/user/repos",
                headers=gh,
                json={"name": repo, "private": False, "auto_init": True,
                      "description": "Posts published by the Lazynext platform"},
            )
            if c.status_code in (201, 422):
                r = await client.put(url, headers=gh, json=body)
        try:
            b = r.json()
        except Exception:
            b = {"raw": r.text[:500]}
        return {"status": r.status_code, "ok": r.status_code < 400, "body": b,
                "fallback": "repo", "url": (b.get("content") or {}).get("html_url")}


async def _gitlab(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<pat>" (gitlab.com) or "<host>:<pat>" — PAT needs 'api' scope.
    first, _, maybe = cred.partition(":")
    host, tok = (first, maybe) if maybe else ("gitlab.com", first)
    text = payload.get("text") or ""
    return await _post(
        f"https://{host}/api/v4/snippets",
        headers={"private-token": tok},
        json_body={
            "title": payload.get("title") or "Lazynext post",
            "visibility": "public",
            "files": [{"file_path": "post.md", "content": text}],
        },
    )


async def _tumblr(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<access_token>:<blog_name>" — tumblr.com/oauth app → OAuth2
    # token; blog_name is the tumblog subdomain ('lazynext' →
    # lazynext.tumblr.com). Posts in NPF: a single text content block.
    token, _, blog = cred.partition(":")
    if not blog:
        return {"ok": False, "error": "conn:tumblr must be '<access_token>:<blog_name>'"}
    return await _post(
        f"https://api.tumblr.com/v2/blog/{blog}/posts",
        headers={"authorization": f"Bearer {token}"},
        json_body={"content": [{"type": "text", "text": payload.get("text") or ""}]},
    )


async def _ghost(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<site_base>|<key_id>:<secret_hex>" — Ghost Admin → Settings →
    # Integrations → custom integration (key shown as '<id>:<secret>'). We
    # mint a 5-min HS256 JWT (kid = key id, aud '/admin/'); '?source=html'
    # converts the html field into the post body.
    import base64
    import hashlib
    import hmac as _hmac
    import json as _json
    import time
    base, _, key = cred.partition("|")
    kid, _, secret = key.partition(":")
    if not base or not kid or not secret:
        return {"ok": False, "error": "conn:ghost must be '<site_base>|<key_id>:<secret_hex>'"}

    def _b64(b: bytes) -> str:
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

    now = int(time.time())
    head = _b64(_json.dumps({"alg": "HS256", "typ": "JWT", "kid": kid}).encode())
    pay = _b64(_json.dumps({"iat": now, "exp": now + 300, "aud": "/admin/"}).encode())
    sig = _b64(_hmac.new(bytes.fromhex(secret), f"{head}.{pay}".encode(), hashlib.sha256).digest())
    text = payload.get("text") or ""
    return await _post(
        f"{base.rstrip('/')}/ghost/api/admin/posts/?source=html",
        headers={"authorization": f"Ghost {head}.{pay}.{sig}"},
        json_body={"posts": [{
            "title": payload.get("title") or text.split("\n")[0][:100],
            "html": text, "status": "published",
        }]},
    )


async def _beehiiv(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<api_key>:<publication_id>" — beehiiv → Settings → API ('pub_…'
    # id). Create-post is a Max/Enterprise endpoint; since Aug-2026 it must
    # carry status:'confirmed' to publish immediately.
    key, _, pub = cred.partition(":")
    if not pub:
        return {"ok": False, "error": "conn:beehiiv must be '<api_key>:<publication_id>'"}
    text = payload.get("text") or ""
    return await _post(
        f"https://api.beehiiv.com/v2/publications/{pub}/posts",
        headers={"authorization": f"Bearer {key}"},
        json_body={
            "title": payload.get("title") or text.split("\n")[0][:100],
            "status": "confirmed",
            "content": {"free_web": text},
        },
    )


# --- Bridges ----------------------------------------------------------------

async def _webhook(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<url>" or "<url>|<bearer>" — generic outbound bridge to
    # Zapier/Make/n8n/IFTTT/Pabbly, which fan out to every other network.
    url, _, bearer = cred.partition("|")
    if not url.startswith("https://"):
        return {"ok": False, "error": "conn:webhook must be an https:// url (|bearer optional)"}
    body: dict[str, Any] = {
        "text": payload.get("text") or "",
        "source": "lazynext",
        "ts": int(__import__('time').time() * 1000),
    }
    if isinstance(payload.get("payload"), dict):
        body["payload"] = payload["payload"]
    return await _post(
        url,
        headers={"authorization": f"Bearer {bearer}"} if bearer else None,
        json_body=body,
    )


async def _ayrshare(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<api_key>" — ayrshare.com dashboard → API Key. One call fans out
    # to every linked network — incl. TikTok, YouTube, Snapchat and GMB, which
    # have no sane direct posting API. Omit 'platforms' to post to all linked
    # networks ("all" is not a documented platform value).
    body: dict[str, Any] = {"post": payload.get("text") or ""}
    if payload.get("platforms"):
        body["platforms"] = payload["platforms"]
    return await _post(
        "https://api.ayrshare.com/api/post",
        headers={"authorization": f"Bearer {cred}"},
        json_body=body,
    )


async def _postiz(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<api_key>|<integration_id>[|<base_url>]" — Postiz → Settings →
    # Public API key; integration (= channel) ids from GET …/public/v1/
    # integrations. base_url defaults to cloud; self-hosted is '<domain>/api'.
    # The auth header takes the raw key — no Bearer prefix.
    key, _, rest = cred.partition("|")
    integ, _, base = rest.partition("|")
    if not integ:
        return {"ok": False, "error": "conn:postiz must be '<api_key>|<integration_id>[|<base_url>]"}
    base = (base or "https://api.postiz.com").rstrip("/")
    text = payload.get("text") or ""
    # Every platform validates a settings.__type — resolve the integration's
    # provider so a bare text post passes schema checks where possible.
    provider = ""
    async with httpx.AsyncClient(timeout=15.0) as client:
        il = await client.get(f"{base}/public/v1/integrations",
                              headers={"authorization": key})
    if il.status_code < 400:
        data = il.json()
        for i in data if isinstance(data, list) else data.get("integrations", []):
            if str(i.get("id")) == integ:
                provider = i.get("identifier") or i.get("provider") or ""
                break
    import datetime as _dt
    return await _post(
        f"{base}/public/v1/posts",
        headers={"authorization": key},
        json_body={
            "type": "now",
            "date": _dt.datetime.now(_dt.timezone.utc).isoformat(),
            "shortLink": False, "tags": [],
            "posts": [{
                "integration": {"id": integ},
                "value": [{"content": text, "image": []}],
                "settings": payload.get("settings") or ({"__type": provider} if provider else {}),
            }],
        },
    )


async def _buffer(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<api_key>:<channel_id>" — buffer.com → Settings → API key; the
    # channel id is in the channel's dashboard URL. GraphQL createPost lands
    # in the channel queue; payload 'share_now': true publishes immediately.
    key, _, chan = cred.partition(":")
    if not chan:
        return {"ok": False, "error": "conn:buffer must be '<api_key>:<channel_id>'"}
    return await _post(
        "https://api.buffer.com",
        headers={"authorization": f"Bearer {key}"},
        json_body={
            "query": "mutation($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id } } ... on MutationError { message } } }",
            "variables": {
                "input": {
                    "text": payload.get("text") or "",
                    "channelId": chan,
                    "schedulingType": "automatic",
                    "mode": "shareNow" if payload.get("share_now") else "addToQueue",
                }
            },
        },
    )


async def _letmepost(payload: dict, cred: str) -> dict:
    if isinstance(payload, str):
        payload = {"text": payload}
    # cred: "<api_key>|<account_ids_csv>[|<base_url>]" — letmepost.dev API
    # key; account ids from GET /v1/accounts. Base defaults to the hosted
    # API; self-hosted image takes '<domain>'. Their reviewed app-of-record
    # posts to X/Bluesky/Pinterest today and Meta/LinkedIn/TikTok as their
    # platform reviews clear — no per-platform approval needed on our side.
    key, _, rest = cred.partition("|")
    accts, _, base = rest.partition("|")
    if not accts:
        return {"ok": False, "error": "conn:letmepost must be '<api_key>|<account_ids>[|<base_url>]"}
    base = (base or "https://api.letmepost.dev").rstrip("/")
    text = payload.get("text") or ""
    if not text:
        return {"ok": False, "error": "text required"}
    return await _post(
        f"{base}/v1/posts",
        headers={"authorization": f"Bearer {key}"},
        json_body={
            "text": text,
            "account_ids": [a.strip() for a in accts.split(",") if a.strip()],
        },
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
        f"https://graph.facebook.com/v25.0/{pid}/messages",
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

async def _youtube(payload: dict, cred: str) -> dict:
    # cred: "<access_token>" — resumable video upload; YouTube has no
    # text/community-post API. payload.media_url is fetched and streamed.
    media = str(payload.get("media_url") or "")
    if not media:
        return {"ok": False, "error": "youtube requires media_url — no text/community posts via API"}
    token = cred.split(":", 1)[0]
    async with httpx.AsyncClient(timeout=60.0) as client:
        init = await client.post(
            "https://upload.youtube.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable",
            headers={"authorization": f"Bearer {token}"},
            json={
                "snippet": {"title": str(payload.get("text") or "Lazynext")[:100],
                            "description": str(payload.get("body") or payload.get("text") or "")},
                "status": {"privacyStatus": str(payload.get("privacy") or "public")},
            },
        )
        loc = init.headers.get("location")
        if init.status_code >= 400 or not loc:
            return {"ok": False, "status": init.status_code, "error": f"upload init failed: {init.text[:200]}"}
        vid = await client.get(media)
        if vid.status_code >= 400:
            return {"ok": False, "status": 400, "error": f"media_url not fetchable ({vid.status_code})"}
        up = await client.put(loc, content=vid.content,
                              headers={"content-type": vid.headers.get("content-type", "video/mp4")})
        return {"status": up.status_code, "ok": up.status_code < 400,
                "body": up.json() if up.content else {}}


async def _tiktok(payload: dict, cred: str) -> dict:
    # cred: "<access_token>" — PULL_FROM_URL: TikTok fetches the video itself;
    # the video_url domain/prefix must be verified in the dev app (else
    # url_ownership_unverified). privacy_level is required for direct post —
    # unaudited apps may only post SELF_ONLY.
    media = str(payload.get("media_url") or "")
    if not media:
        return {"ok": False, "error": "tiktok requires media_url (video) — no text posts via API"}
    return await _post(
        "https://open.tiktokapis.com/v2/post/publish/video/init/",
        headers={"authorization": f"Bearer {cred.split(':', 1)[0]}"},
        json_body={
            "post_info": {
                "title": str(payload.get("text") or "Lazynext")[:150],
                "privacy_level": str(payload.get("privacy") or "SELF_ONLY"),
            },
            "source_info": {"source": "PULL_FROM_URL", "video_url": media},
        },
    )


async def _gmb(text: str, cred: str) -> dict:
    # cred: "<access_token>:<accounts/{a}/locations/{l}>" — Google Business
    # Profile local post.
    token, _, loc = cred.partition(":")
    if not loc:
        return {"ok": False, "error": "conn:gmb must be '<access_token>:<accounts/{a}/locations/{l}>'"}
    return await _post(
        f"https://mybusiness.googleapis.com/v4/{loc}/localPosts",
        headers={"authorization": f"Bearer {token}"},
        json_body={
            "languageCode": "en", "summary": text, "topicType": "STANDARD",
            "callToAction": {"actionType": "LEARN_MORE", "url": "https://lazynext.com"},
        },
    )


async def _lemmy(payload: dict, cred: str) -> dict:
    # cred: "<instance_base>|<username>|<password>" — login per call;
    # payload.to = community_id, payload.body = post body.
    inst, _, rest = cred.partition("|")
    user, _, pw = rest.partition("|")
    text = str(payload.get("text") or "")
    if not inst or not user or not pw:
        return {"ok": False, "error": "conn:lemmy must be '<instance_base>|<username>|<password>'"}
    base = inst.rstrip("/")
    login = await _post(f"{base}/api/v3/user/login",
                        json_body={"username_or_email": user, "password": pw})
    jwt = (login.get("body") or {}).get("jwt")
    if not jwt:
        return {"ok": False, "status": login.get("status"), "error": "lemmy login failed"}
    return await _post(
        f"{base}/api/v3/post",
        headers={"authorization": f"Bearer {jwt}"},
        json_body={"name": text[:200], "body": str(payload.get("body") or text),
                   "community_id": int(payload.get("to") or 0) or None, "auth": jwt},
    )


async def _listmonk(payload: dict, cred: str) -> dict:
    # cred: "<base_url>|<user>|<pass>|<list_id>" — creates a draft campaign.
    bs, _, rest = cred.partition("|")
    user, _, rest2 = rest.partition("|")
    pw, _, lst = rest2.partition("|")
    text = str(payload.get("text") or "")
    if not bs or not lst:
        return {"ok": False, "error": "conn:listmonk must be '<base_url>|<user>|<pass>|<list_id>'"}
    return await _post(
        f"{bs.rstrip('/')}/api/campaigns",
        auth=(user, pw),
        json_body={
            "name": text[:80], "subject": str(payload.get("subject") or text[:80]),
            "lists": [int(lst)], "type": "regular", "content_type": "html",
            "body": str(payload.get("body") or text), "send_later": False,
        },
    )


async def _snapchat(text: str, cred: str) -> dict:
    return {"ok": False, "error": "snapchat has no organic-post API — Marketing API is ads-only"}


async def _nostr(text: str, cred: str) -> dict:
    return {"ok": False, "error": "nostr publishes over relay websockets, not REST — no write endpoint"}


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
    "pinterest": _pinterest, "vk": _vk,
    "youtube": _youtube, "tiktok": _tiktok, "gmb": _gmb, "snapchat": _snapchat,
    "discord": _discord, "slack": _slack, "telegram": _telegram,
    "matrix": _matrix, "teams": _teams, "mattermost": _mattermost,
    "zulip": _zulip, "viber": _viber, "line": _line,
    "devto": _devto, "hashnode": _hashnode, "medium": _medium,
    "wordpress": _wordpress, "github": _github, "gitlab": _gitlab,
    "tumblr": _tumblr, "ghost": _ghost, "beehiiv": _beehiiv,
    "lemmy": _lemmy, "listmonk": _listmonk, "nostr": _nostr,
    "webhook": _webhook, "ayrshare": _ayrshare, "postiz": _postiz,
    "buffer": _buffer, "letmepost": _letmepost,
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


async def request_native_signature(
    signer_email: str,
    title: str,
    doc_text: str | None = None,
    doc_url: str | None = None,
    signer_name: str | None = None,
    requester_email: str | None = None,
) -> dict[str, Any]:
    """Send a document for e-signature via the native Cloudflare flow
    (worker sign.ts — SignWell replacement). Snapshots the doc into KV,
    emails the signer a token-gated link, and freezes a certificate on
    completion. Exactly one of doc_text/doc_url required. Uses the public
    API surface — LAZYNEXT_API_KEY (write scope) is the credential.
    """
    import os
    s = get_settings()
    if not doc_text and not doc_url:
        return {"ok": False, "error": "doc_text or doc_url required"}
    body: dict[str, Any] = {"signer_email": signer_email, "title": title}
    if doc_text:
        body["doc_text"] = doc_text
    if doc_url:
        body["doc_url"] = doc_url
    if signer_name:
        body["signer_name"] = signer_name
    if requester_email:
        body["requester_email"] = requester_email
    # Internal bearer door first (fleet pattern — same as /social/schedule);
    # the public lzk surface is the fallback for caller contexts without it.
    attempts: list[tuple[str, str]] = []
    if s.cloudflare_api_url and s.cloudflare_api_token:
        attempts.append((f"{s.cloudflare_api_url.rstrip('/')}/sign/request", s.cloudflare_api_token))
    lzk = os.environ.get("LAZYNEXT_API_KEY", "")
    if lzk:
        attempts.append(("https://ai-company.lazynext.com/api/v1/sign/requests", lzk))
    if not attempts:
        return {"ok": False, "error": "CLOUDFLARE_API_URL/TOKEN or LAZYNEXT_API_KEY required"}
    last_err = ""
    for endpoint, token in attempts:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.post(
                    endpoint,
                    headers={
                        "authorization": f"Bearer {token}",
                        "content-type": "application/json",
                    },
                    json=body,
                )
            data = r.json()
            if r.status_code < 400:
                return {"ok": True, **{k: data[k] for k in ("public_id", "status", "url", "emailed") if k in data}}
            last_err = data.get("error", f"HTTP {r.status_code}")
        except Exception as e:
            last_err = str(e)
    logger.error("native_sign_failed", signer=signer_email, error=last_err)
    return {"ok": False, "error": last_err}


async def schedule_connector_post(
    connector_id: str,
    payload: dict[str, Any] | str,
    run_at: float | int | str | None = None,
) -> dict[str, Any]:
    """Enqueue a post on the worker-side social scheduler (the Cloudflare-native
    Postiz replacement): D1 `social_posts` + the */10 cron publishes through the
    same dispatch as call_connector. `run_at` accepts unix seconds/ms or an
    ISO-8601 string; None means next tick. Requires the platform bearer.
    """
    if connector_id not in _DISPATCH:
        return {"ok": False, "error": f"unknown connector '{connector_id}'"}
    s = get_settings()
    if not s.cloudflare_api_url or not s.cloudflare_api_token:
        return {"ok": False, "error": "CLOUDFLARE_API_URL/TOKEN not configured"}
    if isinstance(run_at, str):
        try:
            run_at = int(
                datetime.datetime.fromisoformat(run_at.replace("Z", "+00:00")).timestamp() * 1000
            )
        except ValueError:
            return {"ok": False, "error": f"unparseable run_at '{run_at}'"}
    elif isinstance(run_at, (int, float)) and run_at < 10_000_000_000:
        run_at = int(run_at * 1000)  # caller passed seconds — queue stores ms
    body: dict[str, Any] = {"connector": connector_id}
    if isinstance(payload, str):
        body["text"] = payload
    else:
        body["payload"] = payload
    if run_at:
        body["run_at"] = int(run_at)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{s.cloudflare_api_url.rstrip('/')}/social/schedule",
                headers={
                    "authorization": f"Bearer {s.cloudflare_api_token}",
                    "content-type": "application/json",
                },
                json=body,
            )
        data = r.json()
        if r.status_code >= 400:
            return {"ok": False, "error": data.get("error", f"HTTP {r.status_code}")}
        return {"ok": True, "id": data.get("id"), "run_at": run_at, "queued": True}
    except Exception as e:
        logger.error("social_schedule_failed", id=connector_id, error=str(e))
        return {"ok": False, "error": str(e)}
