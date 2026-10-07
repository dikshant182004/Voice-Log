-- Migration 0005: tenant isolation for call telemetry.
ALTER TABLE calls ADD COLUMN tenant_id TEXT;
ALTER TABLE calls ADD COLUMN agent_id TEXT;
ALTER TABLE calls ADD COLUMN agent_version INTEGER;
ALTER TABLE calls ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_calls_tenant_started ON calls(tenant_id, started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_calls_tenant_agent ON calls(tenant_id, agent_id, agent_version);