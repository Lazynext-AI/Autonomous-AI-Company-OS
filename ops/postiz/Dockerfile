# Postiz all-in-one Cloudflare Container image.
# Cloudflare containers expose only HTTP fetch ingress — no container-to-
# container TCP — so the full stack runs on 127.0.0.1 inside one container:
#   postiz-app (frontend+backend) + redis-server + temporal-server.
# Postgres must be EXTERNAL (Neon/Supabase — Cloudflare has no managed
# Postgres); Temporal shares that server via a second database with
# ENABLE_ES=false SQL visibility (no Elasticsearch needed).
FROM temporalio/auto-setup:1.25.2 AS temporal

FROM ghcr.io/gitroomhq/postiz-app:latest
USER root
RUN apk add --no-cache bash redis supervisor
COPY --from=temporal /etc/temporal /etc/temporal
COPY --from=temporal /usr/local/bin/temporal-server /usr/local/bin/temporal-server
COPY --from=temporal /usr/local/bin/temporal-sql-tool /usr/local/bin/temporal-sql-tool
COPY --from=temporal /usr/local/bin/temporal /usr/local/bin/temporal
COPY --from=temporal /usr/local/bin/dockerize /usr/local/bin/dockerize
COPY supervisord.conf /etc/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /etc/temporal/entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
