-- Migration 0007: agent runtime observability and usage telemetry.
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_version INTEGER NOT NULL,
  user_id TEXT,
  session_id TEXT,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  provider_request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_created
  ON agent_runs(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created
  ON agent_runs(tenant_id, agent_id, created_at DESC);
