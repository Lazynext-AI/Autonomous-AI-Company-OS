#!/bin/sh
set -e
mkdir -p /data/redis /run/supervisord

# Temporal on localhost — Postiz connects over 127.0.0.1:7233 inside the
# container, so no external TCP plumbing is needed. The auto-setup
# entrypoint runs schema migrations then execs temporal-server with the
# docker env template; visibility lives on the same external Postgres
# server, separate database (TEMPORAL_DBNAME), ENABLE_ES=false.
cat > /opt/postiz-run.sh <<'P'
#!/bin/sh
# Wait for temporal gRPC before Postiz workers connect.
for i in $(seq 1 60); do
  (echo > /dev/tcp/127.0.0.1/7233) 2>/dev/null && break || sleep 2
done
exec sh -c "${POSTIZ_CMD:-npm run start:prod}"
P
chmod +x /opt/postiz-run.sh

export DB="${DB:-postgres12}"
export POSTGRES_SEEDS="${POSTGRES_SEEDS:-$PGHOST}"
export DB_PORT="${POSTGRES_PORT:-5432}"
export DBNAME="${TEMPORAL_DBNAME:-temporal}"
export VISIBILITY_DBNAME="${TEMPORAL_DBNAME:-temporal}_visibility"
export ENABLE_ES="${ENABLE_ES:-false}"
export POSTGRES_USER="${POSTGRES_USER:-$PGUSER}"
export POSTGRES_PWD="${POSTGRES_PWD:-$PGPASSWORD}"
export BIND_ON_IP="${BIND_ON_IP:-127.0.0.1}"
export TEMPORAL_BROADCAST_ADDRESS="${TEMPORAL_BROADCAST_ADDRESS:-127.0.0.1}"
export SKIP_SCHEMA_SETUP="${SKIP_SCHEMA_SETUP:-false}"

exec /usr/bin/supervisord -c /etc/supervisord.conf
