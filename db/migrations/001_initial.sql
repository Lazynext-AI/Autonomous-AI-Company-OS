-- Autonomous AI Company OS - Initial Schema (Cloudflare D1 / SQLite)
-- Apply with: npx wrangler d1 execute ai-company-db --file db/migrations/001_initial.sql
-- JSON columns are stored as TEXT containing JSON; the client layer encodes/decodes.

-- Company Brain: single row with full company state
CREATE TABLE IF NOT EXISTS company_brain (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_name TEXT,
    product_description TEXT,
    mission TEXT,
    tech_stack TEXT DEFAULT '{}',
    live_urls TEXT DEFAULT '{}',
    current_sprint TEXT DEFAULT '{}',
    metrics TEXT DEFAULT '{
        "users": 0,
        "revenue": 0,
        "mrr": 0,
        "uptime_pct": 100,
        "error_rate": 0,
        "deploy_count": 0
    }',
    open_bugs TEXT DEFAULT '[]',
    shipped_features TEXT DEFAULT '[]',
    user_feedback TEXT DEFAULT '[]',
    agent_statuses TEXT DEFAULT '{}',
    blockers TEXT DEFAULT '[]',
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Agent Memories: per-agent personal memory
CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    agent_id TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL,
    performance_score REAL DEFAULT 100,
    current_task TEXT,
    tasks_completed TEXT DEFAULT '[]',
    tasks_failed TEXT DEFAULT '[]',
    patterns_learned TEXT DEFAULT '[]',
    reward_history TEXT DEFAULT '[]',
    correction_history TEXT DEFAULT '[]',
    retry_count INTEGER DEFAULT 0,
    current_strategy TEXT DEFAULT 'default',
    last_active TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Task Log: all tasks with status and results
CREATE TABLE IF NOT EXISTS task_log (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    task_id TEXT UNIQUE NOT NULL,
    agent_id TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'escalated')),
    attempts INTEGER DEFAULT 0,
    result TEXT,
    error_log TEXT DEFAULT '[]',
    performance_score REAL,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_task_log_status ON task_log(status);
CREATE INDEX IF NOT EXISTS idx_task_log_created ON task_log(created_at);

-- Milestone Log: achieved milestones
CREATE TABLE IF NOT EXISTS milestone_log (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    milestone_type TEXT NOT NULL,
    description TEXT,
    achieved_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Message bus: D1 emulation of Redis Streams + consumer groups.
-- Each (channel, group) pair sees every message; within a group each message
-- is delivered to exactly one consumer via bus_deliveries.
CREATE TABLE IF NOT EXISTS bus_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_bus_messages_channel ON bus_messages(channel, id);

CREATE TABLE IF NOT EXISTS bus_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES bus_messages(id),
    channel TEXT NOT NULL,
    group_name TEXT NOT NULL,
    consumer TEXT NOT NULL,
    delivered_at TEXT NOT NULL,
    UNIQUE(message_id, group_name)
);

CREATE INDEX IF NOT EXISTS idx_bus_deliveries_pending ON bus_deliveries(channel, group_name);

CREATE TABLE IF NOT EXISTS bus_offsets (
    channel TEXT NOT NULL,
    group_name TEXT NOT NULL,
    last_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (channel, group_name)
);

-- Episodic memory: per-agent and company-wide event feeds (7-day retention)
CREATE TABLE IF NOT EXISTS episodic_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_episodic_scope ON episodic_events(scope, id);

-- Knowledge chunks: text lives here; embeddings live in Vectorize (id = chunk id)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    category TEXT NOT NULL,
    chunk_index INTEGER,
    page_number INTEGER,
    content TEXT NOT NULL,
    ingested_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_filename ON knowledge_chunks(filename);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_chunks(category);

-- Download history for the knowledge downloader
CREATE TABLE IF NOT EXISTS download_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Insert initial company brain row if empty
INSERT INTO company_brain (product_name, product_description, mission)
SELECT
    'Autonomous AI Product',
    'A product built by AI agents',
    'Build and launch a valuable software product with zero human intervention'
WHERE NOT EXISTS (SELECT 1 FROM company_brain LIMIT 1);
