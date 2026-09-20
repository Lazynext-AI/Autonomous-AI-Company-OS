-- Public API keys for the Lazynext gateway (REST /api/v1/* and MCP /mcp).
-- Apply with: make worker-migrate
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT UNIQUE NOT NULL,        -- sha256 hex of the key
    key_prefix TEXT NOT NULL,             -- first 12 chars for identification
    name TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT 'read',  -- comma-separated: read,write
    rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_used_at TEXT,
    revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
