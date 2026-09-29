# Postiz on Cloudflare Containers — zero external services

Self-hosted Postiz running entirely on Cloudflare primitives. No Neon, no
VPS, no external database — everything runs inside one container or in R2.

## Architecture

```
https://postiz.lazynext.com/*
  → postiz-stack worker → DO PostizStack (singleton)
    → one container, all on 127.0.0.1:
        postiz-app :5000   (bundled frontend + backend)
        postgres   :5432   (real postgres via apk — full compat)
        redis      :6379   (BullMQ queues)
        temporal   :7233   (postgres12 driver → localhost postgres,
                            ENABLE_ES=false SQL visibility — no ES)
        backup loop        (pg_dumpall → R2 every 15min + on SIGTERM)
```

## Why this shape

- CF containers accept HTTP fetch ingress only — no container-to-container
  TCP — so Temporal/Redis/Postgres must share localhost in one container.
- Real `apk postgresql`, not pglite-in-WASM — Temporal's SQL-visibility
  workload wants full Postgres compat.
- Container fs survives sleep; **R2 snapshots** (`postiz-backup/` prefix in
  `lazynext-media`) survive container eviction — restore runs on boot when
  PGDATA is empty.

## Honest tradeoffs

- **Cold starts**: `sleepAfter=30m` → first hit after idle warms the image
  (~10–30s). Platform cron can ping to keep it warm.
- **Container-hours**: warm 24/7 ≈ 730 hrs/mo — beyond free allowance it
  bills; single-user idle traffic makes real cost much lower.
- **Backup window**: up to 15min of Postgres state can be lost on a hard
  eviction between snapshots.
- **Temporal required since Postiz v2.12.0** — included; its DBs
  (`temporal`, `temporal_visibility`) are created on first boot.

## Setup

1. **R2 API token** (dashboard → R2 → API tokens → Object Read & Write on
   `lazynext-media`) — one token serves both Postiz's S3 uploader and the
   backup sidecar.
2. **Secrets** (from repo root `.env`-loaded shell):

   ```bash
   cd ops/postiz
   export CLOUDFLARE_API_TOKEN=$CLOUDFLARE_DEPLOY_TOKEN
   for k in JWT_SECRET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ACCOUNT_ID \
            CLOUDFLARE_ACCESS_KEY CLOUDFLARE_SECRET_ACCESS_KEY \
            CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_BUCKETNAME CLOUDFLARE_BUCKET_URL \
            POSTGRES_LOCAL_PASSWORD; do npx wrangler secret put $k; done
   ```

   `CLOUDFLARE_*` vars = Postiz's own storage config (same R2 creds);
   `R2_*` vars = the backup sidecar.
3. **Deploy**: `npx wrangler deploy` — wrangler builds the fat image and
   pushes to the CF registry (needs ~6GB local disk; first build is slow).
4. **Domain**: rebind `postiz.lazynext.com` (currently on
   `launchdeck-redirect`) to `postiz-stack`:

   ```bash
   curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains" \
     -H "X-Auth-Key: $CLOUDFLARE_API_KEY" -H "X-Auth-Email: $CLOUDFLARE_EMAIL" \
     -H "Content-Type: application/json" \
     -d '{"hostname":"postiz.lazynext.com","service":"postiz-stack","environment":"production","zone_id":"ff0ad1848e936913a9c4b4e85b1f04af"}'
   ```

5. **Platform creds**: configure each network inside Postiz's UI — self-host
   still needs your own OAuth apps per platform; the 45 native connectors
   cover the zero-approval set meanwhile.

## Health check

`GET /` → Postiz frontend (after container warm). Logs:
`npx wrangler tail postiz-stack`. Backup verify:
`rclone lsf r2:lazynext-media/postiz-backup/` (or the R2 dashboard).
