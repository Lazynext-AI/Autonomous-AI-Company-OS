# Postiz all-in-one Cloudflare Container — ZERO external services.
# CF containers expose only HTTP fetch ingress (no inter-container TCP), so
# everything runs on 127.0.0.1 inside one container via supervisord:
#   postgres (real, apt) :5432   — PGDATA in container fs
#   redis :6379                  — BullMQ queues
#   elasticsearch :9200          — temporal advanced visibility (SQL store caps
#                                  Text search attrs at 3; postiz needs more)
#   temporal-server :7233        — postgres12 driver → localhost postgres
#   postiz-app :5000             — nginx + bundled frontend + backend via pm2
#   backup loop                  — pg_dumpall → R2 every 15m (+ on SIGTERM)
# Durability: container fs survives sleep; R2 snapshot survives eviction.
# Pins mirror postiz's own docker-compose: auto-setup 1.28.1, ES 7.17.27,
# ENABLE_ES + their dynamicconfig/development-sql.yaml.
#
# Size: CF caps container images at 2000MB. postiz-app ships a 3.4GB pnpm
# store (node_modules hardlinks into it — deleting the path is safe) plus a
# 703MB Next build cache; the FROM-scratch flatten is REQUIRED — rm in a
# later layer leaves the bytes in earlier layers.
FROM temporalio/auto-setup:1.28.1 AS temporal

FROM elasticsearch:7.17.27 AS es

FROM ghcr.io/gitroomhq/postiz-app:latest AS app
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql postgresql-contrib redis-server supervisor rclone ca-certificates \
      netcat-openbsd procps curl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /root/.local/share/pnpm /root/.cache/pnpm /root/.npm/_cacache \
    && rm -rf /app/apps/frontend/.next/cache \
    && rm -rf /usr/lib/locale/locale-archive /usr/share/doc /usr/share/man \
    && apt-get clean \
    && groupadd -r elasticsearch && useradd -r -g elasticsearch elasticsearch
COPY --from=temporal /etc/temporal /etc/temporal
COPY --from=temporal /usr/local/bin/temporal-server /usr/local/bin/temporal-server
COPY --from=temporal /usr/local/bin/temporal-sql-tool /usr/local/bin/temporal-sql-tool
COPY --from=temporal /usr/local/bin/temporal /usr/local/bin/temporal
COPY --from=temporal /usr/local/bin/dockerize /usr/local/bin/dockerize
COPY --from=es /usr/share/elasticsearch /usr/share/elasticsearch
COPY dynamicconfig/development-sql.yaml /etc/temporal/config/dynamicconfig/development-sql.yaml
COPY supervisord.conf /etc/supervisord.conf
COPY entrypoint.sh backup.sh r2-restore.sh /opt/
RUN chmod +x /opt/entrypoint.sh /etc/temporal/entrypoint.sh /opt/backup.sh /opt/r2-restore.sh && \
    mkdir -p /data/pg /data/redis /data/es /data/es-logs && \
    chown -R postgres:postgres /data/pg && \
    chown -R elasticsearch:elasticsearch /data/es /data/es-logs /usr/share/elasticsearch

# Flatten into ~280MB bands — one COPY per band. A single 1.3GB layer blob
# never finishes pulling inside the CF host's provisioning window (proven:
# 10MB and 250MB multi-layer images go healthy, the fat single-layer image
# cycles starting→failed with zero container output). The split runs in a
# debian stage against /fs as data — doing it in-place moved /lib64 and
# killed the exec loader mid-run.
FROM debian:bookworm-slim AS split
COPY --link --from=app / /fs/
COPY splitfs.sh /tmp/splitfs.sh
RUN bash /tmp/splitfs.sh /fs

FROM scratch
COPY --from=split /fs/L/b0/ /
COPY --from=split /fs/L/b1/ /
COPY --from=split /fs/L/b2/ /
COPY --from=split /fs/L/b3/ /
COPY --from=split /fs/L/b4/ /
COPY --from=split /fs/L/b5/ /
COPY --from=split /fs/L/b6/ /
COPY --from=split /fs/L/b7/ /
COPY --from=split /fs/L/b8/ /
COPY --from=split /fs/L/b9/ /
COPY --from=split /fs/L/b10/ /
COPY --from=split /fs/L/b11/ /
COPY --from=split /fs/L/b12/ /
COPY --from=split /fs/L/b13/ /
COPY --from=split /fs/L/b14/ /
COPY --from=split /fs/L/b15/ /
COPY --from=split /fs/L/b16/ /
COPY --from=split /fs/L/b17/ /
COPY --from=split /fs/L/b18/ /
COPY --from=split /fs/L/b19/ /
COPY --from=split /fs/L/b20/ /
COPY --from=split /fs/L/b21/ /
COPY --from=split /fs/L/b22/ /
COPY --from=split /fs/L/b23/ /
COPY --from=split /fs/L/b24/ /
COPY --from=split /fs/L/b25/ /
COPY --from=split /fs/L/b26/ /
COPY --from=split /fs/L/b27/ /
COPY --from=split /fs/L/b28/ /
COPY --from=split /fs/L/b29/ /
COPY --from=split /fs/L/b30/ /
COPY --from=split /fs/L/b31/ /
COPY --from=split /fs/L/b32/ /
COPY --from=split /fs/L/b33/ /
COPY --from=split /fs/L/b34/ /
COPY --from=split /fs/L/b35/ /
COPY --from=split /fs/L/b36/ /
COPY --from=split /fs/L/b37/ /
COPY --from=split /fs/L/b38/ /
COPY --from=split /fs/L/b39/ /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NODE_VERSION=22.20.0 \
    YARN_VERSION=1.22.22 \
    NEXT_PUBLIC_VERSION=v2.24.0
WORKDIR /app
# Upstream bug (fixed on postiz-app main, unfixed in the pinned release):
# nostr.provider passes the hex-string password to finalizeEvent, which now
# requires Uint8Array ("expected Uint8Array, got type=string"). Patch the
# compiled backend+orchestrator bundles the same way upstream's secretKey()
# wrapper does.
RUN sed -i 's|}, password);|}, Uint8Array.from(password.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))));|g' \
    apps/orchestrator/dist/libraries/nestjs-libraries/src/integrations/social/nostr.provider.js \
    apps/backend/dist/libraries/nestjs-libraries/src/integrations/social/nostr.provider.js
ENTRYPOINT ["/opt/entrypoint.sh"]
