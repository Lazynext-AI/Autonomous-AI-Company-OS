-- Autonomous AI Company OS - Initial Schema
-- Run this in Supabase SQL Editor

-- Company Brain: single row with full company state
CREATE TABLE IF NOT EXISTS company_brain (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_name TEXT,
    product_description TEXT,
    mission TEXT,
    tech_stack JSONB DEFAULT '{}',
    live_urls JSONB DEFAULT '{}',
    current_sprint JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{
        "users": 0,
        "revenue": 0,
        "mrr": 0,
        "uptime_pct": 100,
        "error_rate": 0,
        "deploy_count": 0
    }',
    open_bugs JSONB DEFAULT '[]',
    shipped_features JSONB DEFAULT '[]',
    user_feedback JSONB DEFAULT '[]',
    agent_statuses JSONB DEFAULT '{}',
    blockers JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent Memories: per-agent personal memory
CREATE TABLE IF NOT EXISTS agent_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL,
    performance_score FLOAT DEFAULT 100,
    current_task JSONB,
    tasks_completed JSONB DEFAULT '[]',
    tasks_failed JSONB DEFAULT '[]',
    patterns_learned TEXT[] DEFAULT '{}',
    reward_history JSONB DEFAULT '[]',
    correction_history JSONB DEFAULT '[]',
    retry_count INT DEFAULT 0,
    current_strategy TEXT DEFAULT 'default',
    last_active TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Task Log: all tasks with status and results
CREATE TABLE IF NOT EXISTS task_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id TEXT UNIQUE NOT NULL,
    agent_id TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'escalated')),
    attempts INT DEFAULT 0,
    result TEXT,
    error_log JSONB DEFAULT '[]',
    performance_score FLOAT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Milestone Log: achieved milestones
CREATE TABLE IF NOT EXISTS milestone_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_type TEXT NOT NULL,
    description TEXT,
    achieved_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE company_brain ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestone_log ENABLE ROW LEVEL SECURITY;

-- Company brain: allow all for service role (agents use service key)
CREATE POLICY "Service role full access company_brain"
    ON company_brain FOR ALL
    USING (true)
    WITH CHECK (true);

-- Agent memories: allow all for service role
CREATE POLICY "Service role full access agent_memories"
    ON agent_memories FOR ALL
    USING (true)
    WITH CHECK (true);

-- Task log: allow all for service role
CREATE POLICY "Service role full access task_log"
    ON task_log FOR ALL
    USING (true)
    WITH CHECK (true);

-- Milestone log: allow all for service role
CREATE POLICY "Service role full access milestone_log"
    ON milestone_log FOR ALL
    USING (true)
    WITH CHECK (true);

-- Anon read for dashboard (optional - use service key for dashboard API)
CREATE POLICY "Anon read company_brain"
    ON company_brain FOR SELECT
    USING (true);

CREATE POLICY "Anon read agent_memories"
    ON agent_memories FOR SELECT
    USING (true);

CREATE POLICY "Anon read task_log"
    ON task_log FOR SELECT
    USING (true);

CREATE POLICY "Anon read milestone_log"
    ON milestone_log FOR SELECT
    USING (true);

-- Insert initial company brain row if empty
INSERT INTO company_brain (product_name, product_description, mission)
SELECT
    'Autonomous AI Product',
    'A product built by AI agents',
    'Build and launch a valuable software product with zero human intervention'
WHERE NOT EXISTS (SELECT 1 FROM company_brain LIMIT 1);
