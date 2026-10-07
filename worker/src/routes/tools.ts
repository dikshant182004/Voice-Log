import { Hono } from 'hono';
import { z } from 'zod';
import { requireIngestAuth, requireTenantHeader } from '../middleware/auth';

interface Env { DB: import('../db').D1Database; INGEST_TOKEN?: string; }

const ToolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  schema: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
  endpoint: z.string().url().optional(),
  enabled: z.boolean().default(true),
  timeout_ms: z.number().int().positive().max(30000).default(5000),
});

export const toolsRouter = new Hono<{ Bindings: Env; Variables: { requestId: string; tenantId: string } }>();
toolsRouter.use('*', requireIngestAuth);
toolsRouter.use('*', requireTenantHeader());

toolsRouter.post('/', async (c) => {
  const parsed = ToolSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid tool', request_id: c.get('requestId'), details: parsed.error.issues } }, 400);
  const t = parsed.data;
  await c.env.DB.prepare(
    'INSERT INTO agent_tools (id, tenant_id, name, description, schema_json, endpoint, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(t.id, c.get('tenantId'), t.name, t.description, JSON.stringify(t.schema), t.endpoint || null, t.enabled ? 1 : 0, new Date().toISOString()).run();
  return c.json(t, 201);
});

toolsRouter.get('/', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, name, description, schema_json, endpoint, enabled, created_at FROM agent_tools WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(c.get('tenantId')).all<any>();
  return c.json({ items: (result.results || []).map((r: any) => ({ ...r, schema: JSON.parse(r.schema_json || '{}'), enabled: Boolean(r.enabled) })) });
});
