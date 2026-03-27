-- Migracja 003: Tabele dla sieci agentów v3
-- Build leads, analytics insights, agent logs

-- Tabela leadów budowlanych
CREATE TABLE IF NOT EXISTS build_leads (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    source VARCHAR(100) NOT NULL,
    source_url VARCHAR(1000) UNIQUE NOT NULL,
    region VARCHAR(100),
    estimated_value DECIMAL(12,2),
    deadline TIMESTAMP,
    category VARCHAR(50) NOT NULL DEFAULT 'other',
    contact_info TEXT,
    status VARCHAR(20) DEFAULT 'new',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_category ON build_leads(category);
CREATE INDEX IF NOT EXISTS idx_leads_status ON build_leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON build_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_region ON build_leads(region);

-- Tabela analytics insights
CREATE TABLE IF NOT EXISTS analytics_insights (
    id SERIAL PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    category VARCHAR(50),
    title VARCHAR(300) NOT NULL,
    description TEXT,
    severity VARCHAR(20) DEFAULT 'info',
    data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_unique
  ON analytics_insights(type, title, (created_at::date));

CREATE INDEX IF NOT EXISTS idx_insights_type ON analytics_insights(type);
CREATE INDEX IF NOT EXISTS idx_insights_severity ON analytics_insights(severity);
CREATE INDEX IF NOT EXISTS idx_insights_created ON analytics_insights(created_at DESC);

-- Tabela logów agentów (persystentne)
CREATE TABLE IF NOT EXISTS agent_logs (
    id SERIAL PRIMARY KEY,
    agent_name VARCHAR(100) NOT NULL,
    level VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_name ON agent_logs(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_logs_level ON agent_logs(level);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC);

-- View: aktywne leady z ostatnich 7 dni
CREATE OR REPLACE VIEW active_leads AS
SELECT * FROM build_leads
WHERE status = 'new'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- View: ostatnie insights
CREATE OR REPLACE VIEW recent_insights AS
SELECT * FROM analytics_insights
WHERE created_at > NOW() - INTERVAL '48 hours'
ORDER BY severity DESC, created_at DESC;

-- Automatyczne czyszczenie starych logów (>30 dni)
-- Będzie uruchamiane przez AIMaintenanceAgent
