# Postiz on Cloudflare Containers

Self-hosted Postiz as one fat Cloudflare Container — the maximum-
Cloudflare-native version of the social aggregator.

## Why one fat container

CF containers only accept HTTP fetch ingress; there is no
container-to-container TCP. Postiz needs Temporal (gRPC :7233) and Redis
(:6379), so all three run on `127.0.0.1` inside a single container via
supervisord. The only external state is Postgres.

## Architecture

```
POST https://postiz.lazynext.com/*
  → postiz-stack worker (this dir)
    → DO `PostizStack` (singleton)
      → container: postiz-app :5000 + redis :6379 + temporal :7233
        → Neon Postgres (external, DATABASE_URL)
        → R2 lazynext-media (STORAGE_PROVIDER=cloudflare)
```

## Known tradeoffs (honest)

- **Cold starts**: container sleeps after 30m idle → first request takes
  ~10-30s while the image warms. Scheduled posts queue in Redis/Temporal
  and re-run on wake; a platform cron ping can keep it warm.
- **Container-hours cost**: warm 24/7 ≈ 730 container-hours/mo — beyond
  free allowance it bills. `sleepAfter` + idle traffic decide real cost.
- **Redis/Temporal state is in-container** — durable across sleep (paused
  fs) but lost if the container instance is evicted.
- **Temporal is required since Postiz v2.12.0** — runs here with
  `ENABLE_ES=false` SQL visibility against the same Postgres server, a
  second database (no Elasticsearch).

## One-time setup

1. **Neon (or Supabase) Postgres** — free tier: one project, databases
   `postiz`, `temporal`, `temporal_visibility`. Grab the connection string.
2. **R2 access keys** — dashboard → R2 → API tokens (Object Read & Write
   on `lazynext-media`).
3. **Secrets**:

   ```bash
   cd ops/postiz
   CLOUDFLARE_API_TOKEN=$CLOUDFLARE_DEPLOY_TOKEN npx wrangler secret put DATABASE_URL
   CLOUDFLARE_API_TOKEN=$CLOUDFLARE_DEPLOY_TOKEN npx wrangler secret put JWT_SECRET
   CLOUDFLARE_API_TOKEN=$CLOUDFLARE_DEPLOY_TOKEN npx wrangler secret put CLOUDFLARE_ACCESS_KEY
   CLOUDFLARE_API_TOKEN=$CLOUDFLARE_DEPLOY_TOKEN npx wrangler secret put CLOUDFLARE_SECRET_ACCESS_KEY
   ```

   Container env vars also needed: `PGHOST`/`POSTGRES_SEEDS` (Neon host),
   `PGUSER`/`POSTGRES_USER`, `PGPASSWORD`/`POSTGRES_PWD`,
   `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_BUCKETNAME=lazynext-media`,
   `CLOUDFLARE_BUCKET_URL`, `CLOUDFLARE_REGION=auto`.
4. **Deploy**: `CLOUDFLARE_API_TOKEN=$CLOUDFLARE_DEPLOY_TOKEN npx wrangler deploy`
   — builds + pushes the image to the CF registry (multi-GB; needs ~6GB
   free local disk for the build context).
5. **Domain**: re-bind `postiz.lazynext.com` from `launchdeck-redirect` to
   `postiz-stack` via `PUT /accounts/{acct}/workers/domains` (the stale-522
   revival path documented in AGENTS.md).
6. Postiz needs each platform's OAuth app credentials — self-host gets no
   reviewed-app shortcut; the 45 native connectors remain the $0-instant
   path while platform apps are reviewed.

## Health check

`GET /` → Postiz frontend. Logs: `wrangler tail postiz-stack`.
