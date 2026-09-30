#!/bin/bash
set -e
# CF's port check kills the container if nothing listens on the declared port
# fast enough — bind nginx :5000 FIRST, before the minutes-long boot work.
nginx 2>/dev/null || true
mkdir -p /data/pg /data/redis /data/es /data/es-logs /data/logs /run/supervisord /var/lib/postgresql /var/run/postgresql
chown -R postgres:postgres /data/pg /var/run/postgresql
chown -R elasticsearch:elasticsearch /data/es /data/es-logs

# Boot beacon: proves how far the container got on the CF runtime — drop
# timestamped markers into R2 at each phase (observability shows nothing until
# the instance is fully active).
beacon() {
  [ -z "${R2_ACCESS_KEY_ID:-}" ] && return 0
  echo "$1" > /tmp/beacon.txt
  RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
  RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  RCLONE_CONFIG_R2_REGION=auto RCLONE_CONFIG_R2_ACL=private \
  rclone --contimeout 10s --timeout 20s --retries 1 \
    copyto /tmp/beacon.txt "r2:${R2_BUCKET:-lazynext-media}/postiz-boot/$(hostname)-$1.txt" 2>/dev/null || true
}
beacon start

export PGPASS="${POSTGRES_LOCAL_PASSWORD:-postiz-local-pw}"
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | head -1)
export PGBIN
export PATH="$PGBIN:$PATH"

# --- Postgres bootstrap: restore the R2 snapshot if PGDATA is empty ---
# runuser (not su) — no PAM session, which micro-VM runtimes can lack.
# dynamic_shared_memory_type=mmap — /dev/shm may be absent or tiny.
if [ ! -s /data/pg/PG_VERSION ]; then
  beacon restore-attempt
  /opt/r2-restore.sh || true
fi
PGOPTS='-c listen_addresses=127.0.0.1 -c dynamic_shared_memory_type=mmap'
if [ ! -s /data/pg/PG_VERSION ]; then
  beacon initdb-start
  if ! runuser -u postgres -- initdb -D /data/pg -U postgres -A trust > /tmp/initdb.log 2>&1; then
    tail -5 /tmp/initdb.log > /tmp/beacon.txt
    RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
    RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
    RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
    rclone copyto /tmp/beacon.txt "r2:${R2_BUCKET:-lazynext-media}/postiz-boot/$(hostname)-initdb-fail.txt" 2>/dev/null || true
  else
    beacon initdb-done
  fi
fi
beacon pgctl-start
runuser -u postgres -- pg_ctl -D /data/pg -o "$PGOPTS" -l /data/pg/pg.log -w -t 120 start > /tmp/pgctl.log 2>&1 || {
  tail -8 /tmp/pgctl.log /data/pg/pg.log > /tmp/beacon.txt 2>/dev/null
  beacon pg-fail
}
beacon pgctl-done
if psql -h 127.0.0.1 -U postgres -c "SELECT 1" >/dev/null 2>&1; then
  psql -h 127.0.0.1 -U postgres -c "ALTER USER postgres PASSWORD '$PGPASS'" || true
  for db in postiz temporal temporal_visibility; do
    psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE $db" || true
  done
  beacon pg-ready
else
  beacon pg-not-ready
fi

# --- Postiz env ---
export DATABASE_URL="postgresql://postgres:$PGPASS@127.0.0.1:5432/postiz"
export REDIS_URL="redis://127.0.0.1:6379"
export TEMPORAL_ADDRESS="127.0.0.1:7233"
export TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-default}"
export TEMPORAL_HOME=/etc/temporal

# --- Temporal env (auto-setup entrypoint consumes these) ---
export DB=postgres12
export POSTGRES_SEEDS=127.0.0.1
export DB_PORT=5432
export DBNAME=temporal
export VISIBILITY_DBNAME=temporal_visibility
export SQL_VIS_DBNAME=temporal_visibility
export SQL_VIS_PLUGIN=postgres12
export ENABLE_ES=true
export ES_SEEDS=127.0.0.1
export ES_PORT=9200
export ES_VERSION=v7
export DYNAMIC_CONFIG_FILE_PATH=config/dynamicconfig/development-sql.yaml
export POSTGRES_USER=postgres
export POSTGRES_PWD="$PGPASS"
export BIND_ON_IP=127.0.0.1
export TEMPORAL_BROADCAST_ADDRESS=127.0.0.1

cat > /opt/postiz-run.sh <<P
#!/bin/bash
# nginx :5000 already bound by the entrypoint — just wait for temporal here.
for i in \$(seq 1 120); do
  (echo > /dev/tcp/127.0.0.1/7233) 2>/dev/null && break || sleep 2
done
exec sh -c "${POSTIZ_CMD:-pnpm run pm2}"
P
chmod +x /opt/postiz-run.sh

beacon supervisord-exec

# Best-effort backup on shutdown so the last state lands in R2.
trap '/opt/backup.sh || true' TERM

exec /usr/bin/supervisord -c /etc/supervisord.conf
