-- Migracja 004: Self-evolving agents — task queue, code generation

CREATE TABLE IF NOT EXISTS code_tasks (
    id SERIAL PRIMARY KEY,
    type VARCHAR(30) NOT NULL DEFAULT 'improvement',
    title VARCHAR(500) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'medium',
    source VARCHAR(100) NOT NULL DEFAULT 'manual',
    status VARCHAR(20) DEFAULT 'pending',
    generated_code TEXT,
    target_file VARCHAR(500),
    ai_reasoning TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_code_tasks_status ON code_tasks(status);
CREATE INDEX IF NOT EXISTS idx_code_tasks_priority ON code_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_code_tasks_source ON code_tasks(source);
CREATE INDEX IF NOT EXISTS idx_code_tasks_created ON code_tasks(created_at DESC);

-- View: pending tasks
CREATE OR REPLACE VIEW pending_code_tasks AS
SELECT * FROM code_tasks
WHERE status IN ('pending', 'review')
ORDER BY
  CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  created_at ASC;

-- View: evolution history
CREATE OR REPLACE VIEW evolution_history AS
SELECT id, type, title, status, source, priority,
       LENGTH(generated_code) as code_length,
       created_at, updated_at
FROM code_tasks
ORDER BY updated_at DESC
LIMIT 100;
