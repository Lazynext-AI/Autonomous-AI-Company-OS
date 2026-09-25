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

## Restore drills

| Date | Drill | Result |
|---|---|---|
| 2026-09-26 | `backups/d1-20260924-060635.sql` (5.5 MB) loaded into local sqlite3 | **PASS** — 24 tables, `PRAGMA integrity_check` = ok. Row counts: `task_log` 415 (293 completed at snapshot), `agent_memories` 13, `knowledge_chunks` 258, `bus_messages` 1150, `briefings` 49, `episodic_events` 1914. |

Remaining unproven step: the **remote** leg — `d1 execute --remote --file`
into a scratch D1 database end-to-end. Re-run this drill after each schema
migration; a dump that parses today can silently rot after the next
`ALTER TABLE`.

## Known gaps

- Artifact retention is 30 days — for longer history, download monthly or
  extend to an R2 bucket. Blocked on the deploy token: `wrangler r2 bucket
  create` fails with auth error 10000 — the token needs `R2 Storage Edit`
  (or a dedicated R2 token as a repo secret). Once a bucket exists, add an
  `r2 object put` step to `backup.yml`.
- KV has no export — acceptable since its data is either ephemeral or
  re-derivable, except `conn:*` credentials which are trivially re-entered.
