import { Hono } from 'hono';
import { z } from 'zod';
import { D1KnowledgeRetriever } from '../knowledge/d1';
import { requireIngestAuth, requireTenantHeader } from '../middleware/auth';

interface Env { DB: import('../db').D1Database; INGEST_TOKEN?: string; }

const SourceSchema = z.object({
  id: z.string().min(1),
  agent_id: z.string().min(1),
  name: z.string().min(1).max(200),
  source_type: z.enum(['text', 'url', 'document']).default('text'),
  uri: z.string().max(2000).optional(),
});

const DocumentSchema = z.object({
  id: z.string().min(1),
  source_id: z.string().min(1),
  title: z.string().min(1).max(300),
  content: z.string().min(1).max(100000),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const knowledgeRouter = new Hono<{ Bindings: Env; Variables: { requestId: string; tenantId: string } }>();
knowledgeRouter.use('*', requireIngestAuth);
knowledgeRouter.use('*', requireTenantHeader());

knowledgeRouter.post('/sources', async (c) => {
  const parsed = SourceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid knowledge source', request_id: c.get('requestId'), details: parsed.error.issues } }, 400);
  const s = parsed.data;
  await c.env.DB.prepare(
    'INSERT INTO knowledge_sources (id, tenant_id, agent_id, name, source_type, uri, status, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(s.id, c.get('tenantId'), s.agent_id, s.name, s.source_type, s.uri || null, 'active', '{}', new Date().toISOString()).run();
  return c.json(s, 201);
});

knowledgeRouter.post('/documents', async (c) => {
  const parsed = DocumentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid knowledge document', request_id: c.get('requestId'), details: parsed.error.issues } }, 400);
  const d = parsed.data;
  const source = await c.env.DB.prepare(
    'SELECT id FROM knowledge_sources WHERE id = ? AND tenant_id = ? LIMIT 1'
  ).bind(d.source_id, c.get('tenantId')).first<any>();
  if (!source) return c.json({ error: { code: 'SOURCE_NOT_FOUND', message: 'Knowledge source not found', request_id: c.get('requestId') } }, 404);
  await c.env.DB.prepare(
    'INSERT INTO knowledge_documents (id, tenant_id, source_id, title, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(d.id, c.get('tenantId'), d.source_id, d.title, d.content, JSON.stringify(d.metadata), new Date().toISOString()).run();
  return c.json(d, 201);
});

knowledgeRouter.get('/search', async (c) => {
  const agentId = c.req.query('agent_id');
  const query = c.req.query('q');
  const limit = Math.max(1, Math.min(Number(c.req.query('limit') || 5), 20));
  if (!agentId || !query) return c.json({ error: { code: 'QUERY_REQUIRED', message: 'agent_id and q are required', request_id: c.get('requestId') } }, 400);
  return c.json({ items: await new D1KnowledgeRetriever(c.env.DB).search({ tenantId: c.get('tenantId'), agentId, query, limit }) });
});
