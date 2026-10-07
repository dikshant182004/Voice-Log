import { MemoryRecord, MemoryRecordSchema, MemoryStore } from './types';
import { D1Database } from '../db';

export class D1MemoryStore implements MemoryStore {
  constructor(private readonly db: D1Database) {}

  async recall(input: { tenantId: string; agentId: string; userId?: string; limit: number }): Promise<MemoryRecord[]> {
    const limit = Math.max(0, Math.min(input.limit, 20));
    if (!limit) return [];
    const result = input.userId
      ? await this.db.prepare(
          'SELECT * FROM memories WHERE tenant_id = ? AND agent_id = ? AND user_id = ? ORDER BY importance DESC, updated_at DESC LIMIT ?'
        ).bind(input.tenantId, input.agentId, input.userId, limit).all<any>()
      : await this.db.prepare(
          'SELECT * FROM memories WHERE tenant_id = ? AND agent_id = ? AND user_id IS NULL ORDER BY importance DESC, updated_at DESC LIMIT ?'
        ).bind(input.tenantId, input.agentId, limit).all<any>();

    return (result.results || []).map((row: any) => MemoryRecordSchema.parse({
      id: row.id, tenant_id: row.tenant_id, agent_id: row.agent_id,
      user_id: row.user_id || undefined, session_id: row.session_id || undefined,
      kind: row.kind, content: row.content, importance: Number(row.importance),
      metadata: JSON.parse(row.metadata_json || '{}'),
    }));
  }

  async write(record: MemoryRecord): Promise<void> {
    const now = new Date().toISOString();
    await this.db.prepare(
      'INSERT INTO memories (id, tenant_id, agent_id, user_id, session_id, kind, content, importance, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      record.id, record.tenant_id, record.agent_id, record.user_id || null,
      record.session_id || null, record.kind, record.content, record.importance,
      JSON.stringify(record.metadata), now, now
    ).run();
  }
}
