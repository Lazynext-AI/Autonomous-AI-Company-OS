-- Briefings table: founder-facing reports written by agents (replaces email).
-- Apply with: npx wrangler d1 execute ai-company-db --remote --file db/migrations/002_briefings.sql
CREATE TABLE IF NOT EXISTS briefings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_briefings_created ON briefings(created_at);
