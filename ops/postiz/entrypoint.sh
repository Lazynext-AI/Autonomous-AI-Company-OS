#!/bin/bash
set -e
mkdir -p /data/pg /data/redis /run/supervisord /var/lib/postgresql
chown -R postgres:postgres /data/pg

export PGPASS="${POSTGRES_LOCAL_PASSWORD:-postiz-local-pw}"
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | head -1)
export PGBIN
export PATH="$PGBIN:$PATH"

# --- Postgres bootstrap: restore the R2 snapshot if PGDATA is empty ---
if [ ! -s /data/pg/PG_VERSION ]; then
  /opt/r2-restore.sh || true
fi
if [ ! -s /data/pg/PG_VERSION ]; then
  su postgres -c "initdb -D /data/pg -U postgres -A trust" >/dev/null
  su postgres -c "pg_ctl -D /data/pg -o '-c listen_addresses=127.0.0.1' -w start"
  psql -h 127.0.0.1 -U postgres -c "ALTER USER postgres PASSWORD '$PGPASS'"
  for db in postiz temporal temporal_visibility; do
    psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE $db" || true
  done
else
  su postgres -c "pg_ctl -D /data/pg -o '-c listen_addresses=127.0.0.1' -w start"
fi

# --- Postiz env ---
export DATABASE_URL="postgresql://postgres:$PGPASS@127.0.0.1:5432/postiz"
export REDIS_URL="redis://127.0.0.1:6379"
export TEMPORAL_ADDRESS="127.0.0.1:7233"
export TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-default}"

# --- Temporal env (auto-setup entrypoint consumes these) ---
export DB=postgres12
export POSTGRES_SEEDS=127.0.0.1
export DB_PORT=5432
export DBNAME=temporal
export VISIBILITY_DBNAME=temporal_visibility
export SQL_VIS_DBNAME=temporal_visibility
export SQL_VIS_PLUGIN=postgres12
export ENABLE_ES=false
export POSTGRES_USER=postgres
export POSTGRES_PWD="$PGPASS"
export BIND_ON_IP=127.0.0.1
export TEMPORAL_BROADCAST_ADDRESS=127.0.0.1

cat > /opt/postiz-run.sh <<P
#!/bin/bash
for i in \$(seq 1 90); do
  (echo > /dev/tcp/127.0.0.1/7233) 2>/dev/null && break || sleep 2
done
exec sh -c "${POSTIZ_CMD:-nginx && pnpm run pm2}"
P
chmod +x /opt/postiz-run.sh

# Best-effort backup on shutdown so the last state lands in R2.
trap '/opt/backup.sh || true' TERM

exec /usr/bin/supervisord -c /etc/supervisord.conf
