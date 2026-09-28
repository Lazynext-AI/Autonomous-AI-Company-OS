# Connector coverage audit

Audited 2026-09-28 against the "every social media platform" requirement;
provider-API drift audit 2026-10-07 (see bottom). The Connector library
(Settings → Connector library, `CONNECTOR_IDS` in `worker/src/services.ts`)
carries 44 entries, each with a real per-platform dispatch
(`callConnector` → `connPost`), not just credential storage.

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
  `th_refresh_token` on `GET graph.threads.net/refresh_access_token`,
  everyone else via `refresh_token`). X auths the exchange via HTTP Basic
  when a client secret is configured (confidential app) and stays
  body+PKCE for public clients.

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
| TikTok | `<token>` — video post via `PULL_FROM_URL` (`media_url`); no text posts. `privacy_level` required — unaudited apps post `SELF_ONLY` only; the video domain must be verified in the dev app |
| Google Business | `<token>:<accounts/{a}/locations/{l}>` — localPosts |
| Bluesky | `<handle>:<app_password>` |
| Mastodon | `<instance_host>:<token>` |
| Reddit | `<client_id>:<secret>:<user>:<pass>:<sub>` |
| Pinterest | `<token>:<board_id>` — `image_url` required (every pin needs media) |
| VK | `<token>:<owner_id>` |
| Discord | webhook URL |
| Slack | webhook URL |
| Telegram | `<bot_token>:<chat_id>` |
| Matrix | `<homeserver>\|<room_id>\|<token>` |
| MS Teams | Power Automate webhook URL — O365 connectors retired May-2026; Adaptive Card envelope |
| Mattermost | webhook URL |
| Zulip | `<site>\|<email>\|<api_key>` |
| Viber | `<token>[:<receiver>]` |
| LINE | `<channel_token>[:<user_id>]` |
| WhatsApp Business | `<token>:<phone_number_id>` |
| Twilio SMS | `<sid>:<token>:<from>` |
| dev.to | api key |
| Hashnode | `<token>:<publication_id>` |
| Medium | integration token — API officially unsupported; still works (best-effort) |
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
- **Buffer** (`conn:buffer` = `<api_key>:<channel_id>`) — GraphQL `createPost`
  scheduler; queues by default, `share_now` publishes immediately.

## Fastest paths — connect today, zero app review

These credentials are self-service and take effect the moment `conn:<id>`
lands in KV (Settings → Connector library, or `POST /kv/put` with the
internal token). No platform-side approval, no OAuth flow, no review
queue — roughly 15 minutes of clicking each:

| Connector | Where the credential comes from |
| --- | --- |
| `discord` / `slack` / `mattermost` | Channel/server settings → Integrations → Webhooks → copy URL |
| `teams` | Power Automate → new flow → "When a Teams webhook request is received" → copy URL |
| `telegram` | @BotFather → `/newbot` → token; `chat_id` via `getUpdates` |
| `bluesky` | Settings → App passwords → `<handle>:<app_password>` |
| `mastodon` | Instance preferences → Development → new app → token; prepend instance host |
| `devto` | dev.to Settings → Extensions → API keys |
| `hashnode` | Hashnode settings → Developer → token + publication id |
| `medium` | Medium Settings → Security and apps → integration token (works, best-effort — API officially unsupported) |
| `wordpress` | WP Admin → Users → Application Passwords → `<site_base>\|<user>\|<app_password>` |
| `ghost` | Ghost Admin → Integrations → custom → Admin API key |
| `gitlab` | GitLab → Preferences → Access Tokens (`api` scope) |
| `matrix` | Any client access token (Element → Settings → Help & About → access token) |
| `zulip` | Zulip → Settings → Bots → API key |
| `reddit` | reddit.com/prefs/apps → create script app → `<client_id>:<secret>:<user>:<pass>:<sub>` |
| `lemmy` | Instance account login — just `<instance>\|<user>\|<pass>` |
| `line` | LINE Developers console → channel → channel access token (self-serve) |
| `beehiiv` | beehiiv Settings → API → key + publication id |
| `tumblr` | tumblr.com/oauth/apps → register → consumer key + blog name |
| `listmonk` | Any listmonk instance URL + user/pass + list id |
| `webhook` | Any URL you control |
| `viber` | partners.viber.com → create bot → token (self-serve, brand-name review is cosmetic) |

That's 20+ dispatch paths live without touching Meta/TikTok/LinkedIn/X
review gates. For the gated majors, the OAuth `connect/{id}/start` flow is
ready; approval is the platform's decision — or bridge through
`ayrshare`/`buffer` in the meantime.

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

## Provider-API drift audit (2026-10-07)

Every adapter's request shape checked against current provider docs:

- **MS Teams** — Office 365 connectors (incoming webhooks, `*.webhook.office.com`)
  permanently disabled May 18–22 2026. Adapter now sends the Adaptive Card
  envelope to a Power Automate Workflows webhook URL.
- **Meta Graph** — `v19.0` expired 2026-05-21; all Graph endpoints (dispatch +
  OAuth auth/token/post-resolution) pinned to `v25.0` (expires 2028-07).
- **LinkedIn** — `POST /v2/ugcPosts` deprecated → migrated to `POST /rest/posts`
  (`Linkedin-Version: 202609`, `X-Restli-Protocol-Version: 2.0.0`, Posts schema).
- **X** — post endpoint moved to canonical `api.x.com`; confidential OAuth
  clients now exchange via HTTP Basic (public clients stay body+PKCE).
- **Threads** — cron refresh was POSTing `refresh_access_token` to
  `/oauth/access_token`; corrected to `GET /refresh_access_token` with
  `grant_type=th_refresh_token`.
- **Pinterest** — `media_source` is mandatory on pin create; `image_url` now
  required in the payload instead of 400ing at the provider.
- **TikTok** — `post_info.privacy_level` is required for direct post; default
  `SELF_ONLY` (unaudited apps can't post publicly). `PULL_FROM_URL` needs the
  media URL's domain/prefix verified in the dev app.
- **Ayrshare** — `platforms` omitted unless specified (posts to all linked
  networks); `["all"]` isn't a documented platform value.
- **Medium** — API officially unsupported (archived docs, no new integrations)
  but integration tokens still function — flagged best-effort.
- Verified current (no change): Bluesky, Mastodon, Reddit, VK `5.199`,
  Discord/Slack/Mattermost webhooks, Telegram, Matrix `client/v3`, Zulip,
  Viber, LINE broadcast, dev.to, Hashnode `publishPost`, WordPress REST,
  GitHub gists, GitLab snippets, Tumblr NPF, Ghost admin JWT (`?source=html`),
  beehiiv v2, Lemmy (sends both header auth + body `auth` — the documented
  0.18/0.19 bridge), Listmonk `send_later`, Twilio, YouTube resumable upload,
  GMB `localPosts`, Postiz public v1, Buffer `createPost`.

## Status

- Connected: `github`, `signwell`, `brevo` (env-backed).
- OAuth-capable connectors also need their `conn:{id}:app` dev-app creds
  (`conn:meta_app` / `conn:google_app` cover their whole product family).
- The remaining ~39 entries need user-supplied credentials — paste them in
  Settings → Connector library or run the OAuth ↗ flow; `conn:<id>` in KV is
  the runtime source of truth (env `CONN_<ID>` secrets are fallback).
