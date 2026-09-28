# Connector coverage audit

Audited 2026-09-28 against the "every social media platform" requirement.
The Connector library (Settings → Connector library, `CONNECTOR_IDS` in
`worker/src/services.ts`) carries 37 entries, each with a real per-platform
dispatch (`callConnector` → `connPost`), not just credential storage.

## Covered directly (first-class POST dispatch)

| Platform | Credential format |
| --- | --- |
| X / Twitter | OAuth2 bearer |
| LinkedIn | `<access_token>[:<numeric_org_id>]` |
| Meta Ads | `<token>:<ad_account_id>` |
| Facebook | `<page_token>:<page_id>` |
| Instagram | `<token>:<ig_user_id>` |
| Threads | `<token>:<threads_user_id>` |
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

Adding catalog entries for these would mislead — there is no public API a
connector could call:

- **Snapchat** (organic Snaps/Stories) — direct; covered via Ayrshare only.
- **TikTok** (direct) — Content Posting API is video-upload only and requires
  an approved app; Ayrshare already handles it.
- **YouTube** community posts — Data API uploads videos only.
- **Quora** — no posting API.
- **Hacker News** — official API is read-only.
- **Product Hunt** — API does not offer public product/comment posting.
- **WeChat / Weibo / Xiaohongshu / Lemon8** — regional platforms with
  gated or nonexistent write APIs (Weibo's open API is review-gated).
- **Kick / Twitch** — chat APIs exist but are channel-chat, not posts;
  reachable via Ayrshare for clip announcements.

## Status

- Connected: `github`, `signwell`, `brevo` (env-backed).
- The remaining 34 first-class entries + 3 aggregators need user-supplied
  credentials — paste them in Settings → Connector library; `conn:<id>` in
  KV is the runtime source of truth (env `CONN_<ID>` secrets are fallback).
