import { AgentDefinition, AgentDefinitionSchema } from './types';
import { D1Database } from '../db';

export type AgentStatus = 'draft' | 'published';

export interface StoredAgent {
  id: string;
  tenant_id: string;
  version: number;
  name: string;
  status: AgentStatus;
  definition: AgentDefinition;
  created_at: string;
  published_at: string | null;
}

function decode(row: any): StoredAgent {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    version: Number(row.version),
    name: row.name,
    status: row.status,
    definition: AgentDefinitionSchema.parse(JSON.parse(row.definition_json)),
    created_at: row.created_at,
    published_at: row.published_at ?? null,
  };
}

export const agentRepo = {
  async create(db: D1Database, tenantId: string, definition: AgentDefinition): Promise<StoredAgent> {
    const now = new Date().toISOString();

    await db.prepare(
      'INSERT INTO agents (id, tenant_id, version, name, status, definition_json, created_at, published_at) VALUES (?, ?, ?, ?, \'draft\', ?, ?, NULL)'
    ).bind(
      definition.id, tenantId, definition.version, definition.name,
      JSON.stringify(definition), now,
    ).run();

    return {
      id: definition.id,
      tenant_id: tenantId,
      version: definition.version,
      name: definition.name,
      status: 'draft',
      definition,
      created_at: now,
      published_at: null,
    };
  },

  async get(db: D1Database, tenantId: string, agentId: string, version?: number, publishedOnly = false): Promise<StoredAgent | null> {
    const statement = version === undefined
      ? db.prepare('SELECT * FROM agents WHERE tenant_id = ? AND id = ? ORDER BY version DESC LIMIT 1').bind(tenantId, agentId)
      : db.prepare('SELECT * FROM agents WHERE tenant_id = ? AND id = ? AND version = ? LIMIT 1').bind(tenantId, agentId, version);
    const row = await statement.first<any>();
    return row ? decode(row) : null;
  },

  async publish(db: D1Database, tenantId: string, agentId: string, version: number): Promise<StoredAgent | null> {
    const agent = await this.get(db, tenantId, agentId, version);
    if (!agent) return null;

    const now = new Date().toISOString();
    await db.batch([
      db.prepare('UPDATE agents SET status = \'draft\', published_at = NULL WHERE tenant_id = ? AND id = ?')
        .bind(tenantId, agentId),
      db.prepare('UPDATE agents SET status = \'published\', published_at = ? WHERE tenant_id = ? AND id = ? AND version = ?')
        .bind(now, tenantId, agentId, version),
    ]);

    return { ...agent, status: 'published', published_at: now };
  },
};
