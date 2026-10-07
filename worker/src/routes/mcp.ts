import { Hono } from 'hono';
import { z } from 'zod';
import { requireIngestAuth, requireTenantHeader } from '../middleware/auth';

interface Env { DB: import('../db').D1Database; INGEST_TOKEN?: string; }

const McpSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  url: z.string().url(),
  auth_ref: z.string().max(200).optional(),
  enabled: z.boolean().default(true),
});

export const mcpRouter = new Hono<{ Bindings: Env; Variables: { requestId: string; tenantId: string } }>();
mcpRouter.use('*', requireIngestAuth);
mcpRouter.use('*', requireTenantHeader());

mcpRouter.post('/', async (c) => {
  const parsed = McpSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid MCP server', request_id: c.get('requestId'), details: parsed.error.issues } }, 400);
  const s = parsed.data;
  await c.env.DB.prepare(
    'INSERT INTO agent_mcp_servers (id, tenant_id, name, url, auth_ref, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(s.id, c.get('tenantId'), s.name, s.url, s.auth_ref || null, s.enabled ? 1 : 0, new Date().toISOString()).run();
  return c.json(s, 201);
});

mcpRouter.get('/', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, name, url, auth_ref, enabled, created_at FROM agent_mcp_servers WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(c.get('tenantId')).all<any>();
  return c.json({ items: (result.results || []).map((r: any) => ({ ...r, enabled: Boolean(r.enabled) })) });
});
