import { Hono } from 'hono';
import { PolicyDefinitionSchema } from '../policy/types';
import { loadPolicies } from '../policy/repository';
import { requireIngestAuth, requireTenantHeader } from '../middleware/auth';

interface Env { DB: import('../db').D1Database; INGEST_TOKEN?: string; }

export const policiesRouter = new Hono<{ Bindings: Env; Variables: { requestId: string; tenantId: string } }>();
policiesRouter.use('*', requireIngestAuth);
policiesRouter.use('*', requireTenantHeader());

policiesRouter.post('/', async (c) => {
  const parsed = PolicyDefinitionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid policy definition', request_id: c.get('requestId'), details: parsed.error.issues } }, 400);
  const p = parsed.data;
  await c.env.DB.prepare(
    'INSERT INTO agent_policies (id, tenant_id, version, name, rules_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(p.id, c.get('tenantId'), p.version, p.name, JSON.stringify(p.rules), new Date().toISOString()).run();
  return c.json(p, 201);
});

policiesRouter.get('/', async (c) => {
  const ids = (c.req.query('ids') || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 50);
  if (!ids.length) return c.json({ items: [] });
  return c.json({ items: await loadPolicies(c.env.DB, c.get('tenantId'), ids) });
});
