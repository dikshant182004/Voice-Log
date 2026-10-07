import { KnowledgeDocument, KnowledgeDocumentSchema, KnowledgeRetriever } from './types';
import { D1Database } from '../db';

export class D1KnowledgeRetriever implements KnowledgeRetriever {
  constructor(private readonly db: D1Database) {}

  async search(input: { tenantId: string; agentId: string; query: string; limit: number }): Promise<KnowledgeDocument[]> {
    const limit = Math.max(1, Math.min(input.limit, 20));
    const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    if (!terms.length) return [];

    // Baseline lexical retrieval. The contract can later be backed by pgvector
    // or another vector service without changing AgentRuntime.
    const conditions = terms.map(() => 'LOWER(d.content) LIKE ?').join(' OR ');
    const bindings = [input.tenantId, input.agentId, ...terms.map(t => '%' + t.replace(/[%_]/g, '') + '%'), limit];
    const result = await this.db.prepare(
      'SELECT d.* FROM knowledge_documents d JOIN knowledge_sources s ON s.id = d.source_id AND s.tenant_id = d.tenant_id WHERE d.tenant_id = ? AND s.agent_id = ? AND (' + conditions + ') ORDER BY d.created_at DESC LIMIT ?'
    ).bind(...bindings).all<any>();

    return (result.results || []).map((row: any) => KnowledgeDocumentSchema.parse({
      id: row.id,
      tenant_id: row.tenant_id,
      source_id: row.source_id,
      title: row.title,
      content: row.content,
      metadata: JSON.parse(row.metadata_json || '{}'),
    }));
  }
}
