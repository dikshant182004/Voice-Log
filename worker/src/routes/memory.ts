import { Hono } from 'hono';
import { MemoryRecordSchema } from '../memory/types';
import { D1MemoryStore } from '../memory/d1';
import { requireIngestAuth, requireTenantHeader } from '../middleware/auth';

interface Env { DB: import('../db').D1Database; INGEST_TOKEN?: string; }

export const memoryRouter = new Hono<{ Bindings: Env; Variables: { requestId: string; tenantId: string } }>();
memoryRouter.use('*', requireIngestAuth);
memoryRouter.use('*', requireTenantHeader());

memoryRouter.get('/', async (c) => {
  const agentId = c.req.query('agent_id');
  const userId = c.req.query('user_id') || undefined;
  const limit = Math.max(1, Math.min(Number(c.req.query('limit') || 10), 20));
  if (!agentId) return c.json({ error: { code: 'AGENT_REQUIRED', message: 'agent_id is required', request_id: c.get('requestId') } }, 400);
  const items = await new D1MemoryStore(c.env.DB).recall({ tenantId: c.get('tenantId'), agentId, userId, limit });
  return c.json({ items });
});

memoryRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = MemoryRecordSchema.safeParse({ ...body, tenant_id: c.get('tenantId') });
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid memory record', request_id: c.get('requestId'), details: parsed.error.issues } }, 400);
  await new D1MemoryStore(c.env.DB).write(parsed.data);
  return c.json(parsed.data, 201);
});
