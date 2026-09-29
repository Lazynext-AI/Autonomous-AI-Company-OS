# Lazynext Pricing Strategy

Status: decided 2026-09-30 · Billing stays Dodo **test-mode** until live flip (KYC).

## The business

Two sellable surfaces share one Dodo account:

1. **Accessibility Checker** (`checker.lazynext.com` / `api.lazynext.com`) — self-serve
   WCAG scanner: rendered mobile-first scans, 75 rules, site crawls, daily
   monitoring, shareable reports, REST + MCP + A2A + JS/Go/Python SDK + CLI +
   embeddable widget + PWA. Buyers: indie devs, agencies, SMBs facing
   ADA Title II (April 2026/2027 deadlines) and EU EAA (enforced since
   June 2025).
2. **The OS itself** (`lazynext.com`) — the autonomous company: 12 agents,
   products under management, API/MCP/CLI/dashboard. Buyers: solo founders,
   technical operators, small teams wanting leverage without headcount.

## Market data (researched 2026-09)

Scanner/monitor segment (our checker's direct comps):

| Vendor | Entry paid | Shape |
|---|---|---|
| WAVE | free | manual, per-page |
| A11yScope | $10/mo | 1 monitored site, weekly |
| Pope Tech | $25–30/mo | 50–500 pages |
| Accessible Web RAMP | $49–599/mo | properties+seats metered |
| Accessibility Cloud | €165/mo+ | annual invoice only |
| Site Brace | $149 one-time | single audit |
| Overlays (accessiBe/UserWay/AudioEye) | $49–479/mo | discredited category — FTC fined accessiBe $1M; courts reject overlays as compliance evidence. We are **not** an overlay — say so |
| Siteimprove / Silktide / Level Access | quote-only, $$$/yr | enterprise suites |

Agentic platforms (OS comps): Devin ≈ $500/mo, Factory/DevRev enterprise —
different capability class; we are a self-serve founder tool, not a
Cognition competitor.

## Decision

### Checker — keep the $9 wedge, add an agency tier, add annual

| Tier | Price | Entitlement |
|---|---|---|
| Free | $0 | 3 scans/day, 3-page site crawl, shareable report, badge |
| **Pro** | **$9/mo or $90/yr** | unlimited scans (500/day), 10-page crawl, **5 monitors**, CSV/JSON/PDF export, email reports, API + MCP + A2A |
| **Agency** | **$39/mo or $390/yr** | everything in Pro + **50 monitors + 25-page crawl** + **white-label reports** (no Lazynext branding — the report carries `plan:'agency'` and renders brandless) |

Why: $9 stays cheapest-in-class and preserves the conversion wedge;
$39 undercuts every agency comp by 2–10× and the white-label report is the
feature agencies actually pay for (resell scans to their clients). Annual =
2 months free (standard SaaS discount, improves cash + retention).
Monitor/crawl caps now vary by plan level — rendered scans cost real
compute, so value scales with price.

Trial: 14-day standard on paid tiers; `config:trial_offer` extended lever
(30d, currently ON) unchanged — one kv/put flips it off.

### OS — keep $0 / $49 / Custom, add annual

| Tier | Price | Entitlement |
|---|---|---|
| Starter | $0 | 3 agents, 1 product, dashboard |
| **Company** | **$49/mo or $490/yr** | 12 agents, 5 products, API + webhooks + CLI + MCP, weekly briefings |
| Enterprise | Custom | unlimited, SSO/audit, custom domains, dedicated support, **deploy-to-your-own-Cloudflare-account option** |

OS plan enforcement is soft today (plan label written to `plan` KV key;
dashboard displays it) — tiers are marketing-forward until real customers
exist. That's honest: don't build hard gates for users we don't have.

## Implementation (all test-mode until live flip)

- New Dodo products via `/api/v1/billing/products` (internal route):
  Pro-annual, Agency-monthly, Agency-annual, Company-monthly, Company-annual.
- `billing.ts` products route gains `period: "Year"` support.
- Product worker: `isPro` → plan-level map (`pro`=1, `agency`=2);
  monitor cap + crawl `maxPages` become level-aware; `/checkout?plan=&term=`
  picks the right product; `result.plan` records the real plan name;
  `report_views.js` renders brandless when `plan === 'agency'`.
- index.html pricing section gains the Agency card (sync-page regenerates
  `src/page.js`); JSON-LD `offers` updated.
- Live flip checklist unchanged: KYC → live key/base → recreate all
  products live → webhook → WELCOME20.
