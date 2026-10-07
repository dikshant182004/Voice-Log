-- Migration 0003: Configurable agent platform foundation.
-- Agent definitions are versioned and immutable once published.

CREATE TABLE IF NOT EXISTS agents (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  PRIMARY KEY (tenant_id, id, version)
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant_id ON agents(tenant_id, id, version DESC);
CREATE INDEX IF NOT EXISTS idx_agents_published ON agents(tenant_id, id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_one_published
  ON agents(tenant_id, id)
  WHERE status = 'published';
