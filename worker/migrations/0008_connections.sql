-- Customer-owned integration connection registry.
-- Secrets are never stored here. secret_ref points to an operator-managed secret
-- (for example CONNECTION_SECRET_<ref>) or a future external secret manager.
CREATE TABLE IF NOT EXISTS connections (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  secret_ref TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_connections_tenant_created
  ON connections(tenant_id, created_at DESC);
