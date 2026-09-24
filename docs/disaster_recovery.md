# Disaster recovery

## What is backed up

| Resource | Backup | Schedule |
|---|---|---|
| D1 `ai-company-db` (tasks, metrics, ledger, briefings) | `.github/workflows/backup.yml` → `wrangler d1 export` → workflow artifact | Weekly (Sun 03:00 UTC), 30-day retention |
| KV `EPHEMERAL` | Not exported | Ephemeral by design — leads, trials, licenses, `conn:*` credentials. Loss = re-onboard connectors + licenses resync via `reconcileBilling()` against Dodo. |
| Vectorize `company-knowledge` | Not exported | Rebuildable — re-ingest `knowledge_base/` + `docs/research/`. |
| Worker code / dashboard / product site | Git (this repo + `Lazynext-Platform/accessibility-checker`) | Continuous |

## Manual backup

```sh
scripts/db_backup.sh    # writes backups/d1-<timestamp>.sql (gitignored)
```

## Restore

```sh
cd worker
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_DEPLOY_TOKEN" \
  npx wrangler d1 execute ai-company-db --remote --file ../backups/d1-<timestamp>.sql
```

For a CI artifact: download `d1-backup-*` from the Actions run, unzip, and pass
the `.sql` to the same `d1 execute --file` command.

## After a restore

1. Re-run billing reconciliation so `license:*`/`subs:active` match Dodo:
   `GET /api/v1/billing/subscriptions` with the admin token verifies the Dodo side.
2. Re-set `conn:*` KV credentials via Settings (or `.env` fallbacks still work).
3. Re-deploy both product workers if scripts were lost (see AGENTS.md —
   `accessibility-checker` + `accessibility-checker-api` must stay in sync).

## Known gaps

- Artifact retention is 30 days — for longer history, download monthly or
  extend to an R2 bucket (would need a new binding + export script).
- KV has no export — acceptable since its data is either ephemeral or
  re-derivable, except `conn:*` credentials which are trivially re-entered.
