#!/bin/bash
# Backup: pg_dumpall → gzip → R2 (rclone S3 remote 'r2'). No-op when R2
# creds aren't configured — local durability (container fs) still holds.
set -u
[ -z "${R2_ACCESS_KEY_ID:-}" ] && exit 0
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | head -1)
export PATH="$PGBIN:$PATH"
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_REGION=auto
export RCLONE_CONFIG_R2_ACL=private

OUT=/tmp/pg-$(date +%Y%m%dT%H%M%S).sql.gz
PGPASSWORD="$PGPASS" pg_dumpall -h 127.0.0.1 -U postgres | gzip > "$OUT" || exit 1
rclone copyto "$OUT" "r2:${R2_BUCKET:-lazynext-media}/postiz-backup/latest.sql.gz" && \
rclone copyto "$OUT" "r2:${R2_BUCKET:-lazynext-media}/postiz-backup/$(basename "$OUT")" || exit 1
rm -f "$OUT"
