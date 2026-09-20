-- Outbound webhooks: platform pushes bus events to registered URLs.
-- Apply with: make worker-migrate
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,                    -- https only
    channels TEXT NOT NULL DEFAULT '*',   -- comma-separated channels or '*'
    secret TEXT,                          -- optional HMAC signing secret
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    message_id TEXT NOT NULL,
    status_code INTEGER,
    error TEXT,
    attempted_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries(endpoint_id);
