# Postiz all-in-one Cloudflare Container — ZERO external services.
# CF containers expose only HTTP fetch ingress (no inter-container TCP), so
# everything runs on 127.0.0.1 inside one container via supervisord:
#   postgres (real, apt) :5432  — PGDATA in container fs
#   redis :6379                 — BullMQ queues
#   temporal-server :7233       — postgres12 driver → localhost postgres
#   postiz-app :5000            — nginx + bundled frontend + backend via pm2
#   backup loop                 — pg_dumpall → R2 every 15m (+ on SIGTERM)
# Durability: container fs survives sleep; R2 snapshot survives eviction.
#
# Size: CF caps container images at 2000MB. postiz-app ships a 3.4GB pnpm
# store (node_modules hardlinks into it — deleting the path is safe) plus a
# 703MB Next build cache; the FROM-scratch flatten is REQUIRED — rm in a
# later layer leaves the bytes in earlier layers.
FROM temporalio/auto-setup:1.25.2 AS temporal

FROM ghcr.io/gitroomhq/postiz-app:latest AS app
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql postgresql-contrib redis-server supervisor rclone ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /root/.local/share/pnpm /root/.cache/pnpm /root/.npm/_cacache \
    && rm -rf /app/apps/frontend/.next/cache \
    && rm -rf /usr/lib/locale/locale-archive /usr/share/doc /usr/share/man \
    && apt-get clean
COPY --from=temporal /etc/temporal /etc/temporal
COPY --from=temporal /usr/local/bin/temporal-server /usr/local/bin/temporal-server
COPY --from=temporal /usr/local/bin/temporal-sql-tool /usr/local/bin/temporal-sql-tool
COPY --from=temporal /usr/local/bin/dockerize /usr/local/bin/dockerize
COPY supervisord.conf /etc/supervisord.conf
COPY entrypoint.sh backup.sh r2-restore.sh /opt/
RUN chmod +x /opt/entrypoint.sh /etc/temporal/entrypoint.sh /opt/backup.sh /opt/r2-restore.sh && \
    mkdir -p /data/pg /data/redis && chown -R postgres:postgres /data/pg

# Flatten: single layer containing only the final filesystem.
FROM scratch
COPY --from=app / /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NODE_VERSION=22.20.0 \
    YARN_VERSION=1.22.22 \
    NEXT_PUBLIC_VERSION=v2.24.0
WORKDIR /app
ENTRYPOINT ["/opt/entrypoint.sh"]
