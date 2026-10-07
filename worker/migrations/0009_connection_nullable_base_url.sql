-- D1-managed connections do not require an external URL.
-- Rebuild the table because SQLite cannot directly drop a NOT NULL constraint.
CREATE TABLE connections_v2 (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT,
  secret_ref TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

INSERT INTO connections_v2 (id, tenant_id, name, type, base_url, secret_ref, config_json, enabled, created_at, updated_at)
SELECT id, tenant_id, name, type, base_url, secret_ref, config_json, enabled, created_at, updated_at
FROM connections;

DROP TABLE connections;
ALTER TABLE connections_v2 RENAME TO connections;

CREATE INDEX IF NOT EXISTS idx_connections_tenant_created
  ON connections(tenant_id, created_at DESC);
