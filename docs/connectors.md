# Connector coverage audit

Audited 2026-09-28 against the "every social media platform" requirement.
The Connector library (Settings → Connector library, `CONNECTOR_IDS` in
`worker/src/services.ts`) carries 44 entries, each with a real per-platform
dispatch (`callConnector` → `connPost`), not just credential storage.

## Self-hosted OAuth connect (replaces hosted aggregators)

`worker/src/connect_oauth.ts` runs the whole OAuth dance inside the platform
Worker — no third-party aggregation service required:

- `GET /api/v1/connect/{id}/start` — admin-scoped. `?key=<lzk_admin>` 302s
  (dashboard "OAuth ↗" link); an `Authorization` header returns
  `{authorize_url}` JSON instead. PKCE S256 is used for X and TikTok.
- `GET /api/v1/connect/{id}/callback` — public; the one-time `oauth:state:*`
  KV token (600s TTL) is the auth. Exchanges the code, resolves the
  account-specific suffix via the provider API (page id, ig user id,
  threads uid, ad account, board id, person urn, GMB location), and writes
  `conn:{id}` in the flat format `callConnector` expects.
- `conn:{id}:app` = `"client_id[:client_secret]"` — the platform dev app you
  register once per vendor. Meta-family connectors fall back to shared
  `conn:meta_app`; Google-family to `conn:google_app`.
- `conn:{id}:oauth` — raw token JSON (`access_token`, `refresh_token`,
  `expires_at`, `cred_suffix`). The cron `refreshConnectorTokens` sweep renews
  inside the expiry window (Meta via `fb_exchange_token`, Threads via
  `refresh_access_token`, everyone else via `refresh_token`).

OAuth-capable connectors: `x`, `linkedin`, `facebook`, `instagram`,
`threads`, `meta`, `whatsapp`, `pinterest`, `youtube`, `gmb`, `tiktok`.

**Honest gate:** platform *app approval* is still the platform's decision —
Meta advanced access, TikTok audit, LinkedIn product access all review-gate
on their side. This layer removes the aggregator's hosting bill, not their
approval. Hosted aggregators remain as fallback connectors
(`ayrshare`/`postiz`/`buffer`) for anything still under review.

## Covered directly (first-class POST dispatch)

| Platform | Credential format |
| --- | --- |
| X / Twitter | OAuth2 bearer |
| LinkedIn | `<access_token>[:<urn or numeric org id>]` |
| Meta Ads | `<token>:<ad_account_id>` |
| Facebook | `<page_token>:<page_id>` |
| Instagram | `<token>:<ig_user_id>` |
| Threads | `<token>:<threads_user_id>` |
| YouTube | `<token>` — resumable **video upload** (`media_url`); no text posts exist |
| TikTok | `<token>` — video post via `PULL_FROM_URL` (`media_url`); no text posts |
| Google Business | `<token>:<accounts/{a}/locations/{l}>` — localPosts |
| Bluesky | `<handle>:<app_password>` |
| Mastodon | `<instance_host>:<token>` |
| Reddit | `<client_id>:<secret>:<user>:<pass>:<sub>` |
| Pinterest | `<token>:<board_id>` |
| VK | `<token>:<owner_id>` |
| Discord | webhook URL |
| Slack | webhook URL |
| Telegram | `<bot_token>:<chat_id>` |
| Matrix | `<homeserver>\|<room_id>\|<token>` |
| MS Teams | webhook URL |
| Mattermost | webhook URL |
| Zulip | `<site>\|<email>\|<api_key>` |
| Viber | `<token>[:<receiver>]` |
| LINE | `<channel_token>[:<user_id>]` |
| WhatsApp Business | `<token>:<phone_number_id>` |
| Twilio SMS | `<sid>:<token>:<from>` |
| dev.to | api key |
| Hashnode | `<token>:<publication_id>` |
| Medium | integration token |
| WordPress | `<site_base>\|<user>\|<app_password>` |
| GitHub | PAT (connected) |
| GitLab | `<pat>` or `<host>:<pat>` |
| Tumblr | `<token>:<blog>` |
| Ghost | `<base>\|<admin_key>` |
| beehiiv | `<api_key>:<publication_id>` |
| Lemmy | `<instance>\|<user>\|<pass>` — `to` = community_id |
| Listmonk | `<base>\|<user>\|<pass>\|<list_id>` — draft campaigns |
| Brevo | `[<sender>:]<key>` (connected via env) |
| SignWell | `[test:]<key>` (connected) |
| Generic webhook | `<https_url>[\|<bearer>]` |

## Covered via aggregators (one credential → many networks)

- **Ayrshare** (`conn:ayrshare` = api key) — fans out a single post to
  TikTok, YouTube, X, Instagram, Facebook, LinkedIn, Pinterest, Snapchat,
  Reddit, Telegram, Threads, Bluesky, and Google Business Profile.
  This is the path for TikTok/YouTube/Shorts-era platforms.
- **Postiz** (`conn:postiz` = `<api_key>|<integration_id>[|<base_url>]`) —
  open-source social scheduler; supports its full integration set.
- **Buffer** (`conn:buffer` = `<token>:<profile_id>`) — classic scheduler.

## No programmatic write API exists (cannot be honestly connected)

`snapchat` and `nostr` are catalog entries that fail fast with an
explanatory error rather than pretending to work — Snapchat's Marketing API
is ads-only (organic Snaps/Stories have no write endpoint) and Nostr
publishes over relay websockets, not REST. The rest have no API at all:

- **Quora** — no posting API.
- **Hacker News** — official API is read-only.
- **Product Hunt** — API does not offer public product/comment posting.
- **WeChat / Weibo / Xiaohongshu / Lemon8** — regional platforms with
  gated or nonexistent write APIs (Weibo's open API is review-gated).
- **Kick / Twitch** — chat APIs exist but are channel-chat, not posts;
  reachable via Ayrshare for clip announcements.
- **YouTube community posts / TikTok text** — don't exist; the `youtube` and
  `tiktok` connectors cover their only write surfaces (video).

## Status

- Connected: `github`, `signwell`, `brevo` (env-backed).
- OAuth-capable connectors also need their `conn:{id}:app` dev-app creds
  (`conn:meta_app` / `conn:google_app` cover their whole product family).
- The remaining ~39 entries need user-supplied credentials — paste them in
  Settings → Connector library or run the OAuth ↗ flow; `conn:<id>` in KV is
  the runtime source of truth (env `CONN_<ID>` secrets are fallback).
