# External dependency classification

What runs on Cloudflare, what stays outside, and why. Compiled 2026-09-29
from the live deployment audit — the "replace everything with Cloudflare
serverless" mandate ends where regulation or network ownership begins.

The rule that shaped the architecture: **Cloudflare is the control plane and
the data plane wherever both are legal and technically possible. Where a
capability is regulated (payments, e-sign) or owned by a network (social
platforms, email delivery), Cloudflare hosts the orchestration and the
provider carries only the irreducible external act.**

## Fully replaced — was external/self-hosted, now native Cloudflare

| Was | Now | Where |
| --- | --- | --- |
| Postiz self-host (~20Gi disk, Postgres, Redis) | Cloudflare Queues `social-posts` + DLQ + D1 `social_posts`; `dispatchSocialPost` claims atomically, credential gate before dispatch, `run_at` doubles as claim deadline | `worker/src/services.ts`, `worker/src/index.ts` `queue()` |
| Cron-polled scheduler (±10min latency) | Producer `send()` at insert (second precision, `delaySeconds` ≤12h) + `*/10` cron sweep as cold-path + rescue | same |
| Hosted OAuth aggregators (required) | Self-hosted `GET /api/v1/connect/{id}/start|callback` inside the Worker — PKCE, `oauth:state:*` KV tokens, per-family `conn:{id}:app` creds, cron `refreshConnectorTokens` | `worker/src/connect_oauth.ts` |
| Aggregator fan-out (optional now) | `ayrshare`/`postiz`/`buffer` remain ordinary connectors for platforms still under app review | `CONNECTOR_IDS` |
| Media storage service | KV `media:{id}` binary store (≤5MB), `GET /media/{uuid}` public immutable serve for platform-side fetches | `worker/src/index.ts` |
| Signature SaaS for non-legal flows | Native e-sign `worker/src/sign.ts` — send→sign→certificate with consent, IP/UA audit, KV-frozen doc snapshot | `worker/src/sign.ts` |
| 24 retired self-hosted tools (supabase, n8n, formbricks, plane, chatwoot, novu, umami…) | All hostnames bound to `launchdeck-redirect` worker (301→apex) via `workers/domains` PUTs — no per-service worker, no DNS edits | `ops/launchdeck-redirect/` |
| Task queue / state / knowledge / inference / browser / sandbox / scheduling | D1 `ai-company-db` + KV `EPHEMERAL` + Vectorize `company-knowledge` (384d) + Workers AI + Browser Rendering `/render` + Containers `CODE_EXEC` + Cron `*/10` | `worker/` |
| Company→agent task bus | `bus_messages` D1 + MCP `create_task`/`publish_message` | `worker/src/index.ts` |

## Cloudflare-hosted orchestration, external execution — partial replacement

Cloudflare owns the state machine; the provider owns one irreducible act.

| Dependency | Cloudflare side (native) | External side (cannot be replaced) |
| --- | --- | --- |
| **Dodo Payments** | `/checkout` session creation + 302, `subs:active`/`license:` entitlement state (KV), webhook ingest with Svix-style signature verify + `whseen:` replay dedup, `past_due` → `pastdue:` + bus event, `reconcileBilling` downgrade sweep, discounts API (`WELCOME20`), `license_keep:` operator exemptions | Card processing, merchant-of-record, KYC/AML, tax remittance (GST/VAT computed at checkout), chargebacks, PCI. **Decision: test-mode permanently (2026-09-29) — no live flip.** |
| **Brevo** | Template render, send pipeline, `unsubSig` HMAC unsubscribe links, engagement tracking (`episodic_events`), campaign segmentation, lead nurture sequences | Outbound SMTP/API delivery. Cloudflare Email Workers receive/forward mail; they cannot originate arbitrary outbound email. Sole provider — Resend fully removed, do not reintroduce. |
| **SignWell** | `signwellSendFromTemplate` orchestration, `signsent:<sub>` dedup, `ctx.waitUntil` on webhook, `signwell.errors` bus channel | Legally-binding signatures — trust-provider timestamps and eIDAS/ESIGN standing. Native `sign.ts` covers non-legal flows only. `conn:signwell` holds a real (non-test) key. |
| **Social platforms** (44 connectors) | Registry (`CONNECTOR_IDS`), OAuth dance, `conn:*` KV cred vault, `conn:{id}:app` dev-app creds, token refresh cron, Queue-backed scheduling, bounded retries, `episodic_events` audit | The networks' write APIs and their app-review gates (Meta advanced access, TikTok audit, LinkedIn product access). Ownership of the network is ownership of the API. |
| **Serper** | Whole search chain runs in-Worker: Serper → DDG Lite scrape → DDG instant-answer (`websearch.ts`), provider labeled on every response | Optional quality upgrade only. `SERPER_API_KEY` absent → DDG path, still fully functional. Not infrastructure. |
| **GitHub** | PR monitoring, workflow-failure fix tasks, self-scan CI drift checks | Repo hosting + Actions runners — external by nature. |

## External by nature — no honest replacement exists

- **Dodo live mode**: if ever flipped (currently test permanently), the live
  flip is an ops procedure — KYC → live `DODO_API_KEY` + `DODO_API_BASE` →
  recreate product + webhook + `WELCOME20` → verify
  `GET /api/v1/billing/webhooks` shows `disabled:false`. Documented in
  AGENTS.md; not a code change.
- **R2 object storage**: would replace the 5MB-capped KV media library for
  large assets. Blocked on deploy-token scope (`R2 Storage Edit`), not on
  code — KV is the correct store until the scope lands.
- **Social credentials**: `conn:<id>` values are user-supplied secrets;
  platform app approvals are the platform's decision.
- **Platforms with no write API** (Quora, HN, Product Hunt, WeChat, Weibo,
  Xiaohongshu, Lemon8, Kick/Twitch organic, Snapchat organic, Nostr):
  catalogued in `docs/connectors.md` — fail fast with explanatory errors
  rather than pretend.

## What Cloudflare fundamentally cannot do

- Process card payments / act as merchant of record (regulated)
- Provide legally-binding e-signature trust (timestamps, eIDAS/ESIGN)
- Originate arbitrary outbound email (Email Workers are inbound-only)
- Post to a social network without that network's API + approval
- Host git remotes or Actions runners

Never claim otherwise in code, docs, or product copy.
