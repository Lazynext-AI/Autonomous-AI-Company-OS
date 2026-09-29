# First-wave campaign content

Channels this wave can publish to the moment `conn:*` credentials land —
no platform approval needed: **dev.to, Hashnode, Bluesky, Mastodon,
Reddit (script app), Discord, Slack, Telegram, Tumblr**. Blog posts are the
canonical assets (they drive SEO to lazynext.com); social snippets
link to them. Angles are real product truths — no invented metrics.

## Article 1 — dev.to + Hashnode (flagship SEO piece)

**Title**: I let 12 AI agents run a company for N days — here's what broke

**Canonical**: https://lazynext.com/ (or a blog post once marketing has one)

Outline → the fleet already writes full drafts; this is the brief the
marketing agent expands:

- The setup: what "autonomous company" means here — a shared brain (D1),
  task decomposition, a queue, agents that write and ship real code.
- What worked: dead-corpus dedup, phantom-completion gates, the PR loop.
- What broke honestly: phantom completions claiming merged PRs, doc
  rewrites respawning shipped-work tasks, KV TTL footguns.
- The product it shipped: checker.lazynext.com — an accessibility scanner
  its own UI scores 100/100 on.
- Close: the repo is open; the platform is live.

**dev.to front matter**:
```yaml
title: "I let 12 AI agents run a company — here's what broke"
tags: ai, agents, automation, webdev
published: true
canonical_url: https://lazynext.com/
```
`conn:devto` posts markdown via `POST /api/articles` — `title` field
overrides the first line; `draft: true` for silent review first.

## Article 2 — dev.to + Hashnode (technical depth)

**Title**: Building a WCAG scanner on Cloudflare Workers — rendered scans
on the edge

- Why rendered (not static) scanning matters — JS apps ship a11y bugs
  static parsers never see.
- The stack: Workers + Browser Rendering + KV quota + D1 stats.
- 74 WCAG criteria — what a scanner can honestly detect vs. what needs a
  human (the honest-scope angle is the differentiator; overlays got an
  FTC fine).
- Keyboard-trap detection story: focus-cycling probes + statics for
  addEventListener Tab-swallows.

## Article 3 — Hashnode/dev.to (founder angle)

**Title**: Everything Cloudflare replaced in my stack — a cost accounting

- Old stack (retired): self-hosted Supabase, Postiz, n8n, Chatwoot,
  Documenso, umami, Resend/SendGrid — ~24 hosts, all real.
- New stack: Workers + D1 + KV + R2 + Vectorize + Queues + Cron +
  Containers + Browser Rendering.
- Actual line items: what stayed external (Dodo billing, Brevo email —
  legal sending needs deliverability infra), what went to $0.

## Social snippets (per-channel)

**Bluesky / Mastodon / Threads** (300–500 chars):
> We're an AI company that literally runs itself — 12 agents research,
> build, and ship products on Cloudflare Workers. Latest: an
> accessibility checker that finds WCAG issues on rendered pages, not
> just markup. Free tier live: checker.lazynext.com

**Reddit** (self-post to r/webdev or r/accessibility — pick one,
`conn:reddit` `to` override works):
> I built an accessibility checker that renders pages at a mobile
> viewport and catches things static scanners miss — keyboard traps,
> focus-stealing handlers, cross-page issues. 74 WCAG criteria, free
> tier, no signup to scan. Genuinely interested in feedback on the
> rule set: checker.lazynext.com

**Discord/Slack webhook** (own community or partner servers):
> New: rendered WCAG scanning on Cloudflare Workers — free tier, MCP +
> A2A + API + widget. checker.lazynext.com

**dev.to comment/Hashnode**: cross-link the articles.

## Cadence

Week 1: Article 1 + social snippets day 1–2; Article 2 day 4; Article 3
day 7. Queue via `/api/v1/social` → `social-posts` queue (batch 10, DLQ
armed). All X posts cost $0.20/URL-post — deferred until free channels
prove conversion.
