#!/usr/bin/env bash
# Export the D1 database to a timestamped SQL dump in backups/ (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
[ -n "${CLOUDFLARE_DEPLOY_TOKEN:-}" ] && export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_DEPLOY_TOKEN"

mkdir -p backups
OUT="backups/d1-$(date +%Y%m%d-%H%M%S).sql"
(cd worker && npx wrangler d1 export ai-company-db --remote --output "../$OUT")
echo "Backup written: $OUT ($(du -h "$OUT" | cut -f1))"
