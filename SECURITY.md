# Security Policy

## Reporting a Vulnerability

Email **support@lazynext.com** with a description, reproduction, and affected
surface. Do not open a public issue for unpatched vulnerabilities. We aim to
acknowledge within 72 hours.

## Scope

Live surfaces:

- `https://ai-company-os.dry-hall-6a50.workers.dev` — platform worker
- `https://accessibility-checker.dry-hall-6a50.workers.dev` — product worker
- `https://dashboard.lazynext.com` — operations dashboard

## Auth model (for testers)

- Internal ops routes (`/query`, `/kv/*`, `/bus/*`, `/render`, `/email/*`)
  require the internal bearer token (`env.API_TOKEN`). They are not public.
- Public API routes (`/api/v1/*`) require `lzk_` API keys with per-key scopes.
- Connector credentials live in KV `conn:*` behind a credential guard —
  `GET` returns 403 even to authenticated callers.
- The dashboard uses a passphrase + optional TOTP; session cookies are
  `HttpOnly`.

## Credential handling

- Never commit secrets. `.env` is gitignored; `.env.example` holds names only.
- Secrets in Workers are set via `wrangler secret put`, never in code or
  `wrangler.jsonc` vars.
- Deploy tokens and the internal API token are distinct; rotate the deploy
  token (`CLOUDFLARE_DEPLOY_TOKEN`) if a remote URL ever embeds it.
