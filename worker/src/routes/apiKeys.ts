import { Hono } from 'hono';
import { sha256Hex } from '../middleware/auth';
import { requireIngestAuth, requireTenantHeader } from '../middleware/auth';

interface Env { DB: import('../db').D1Database; INGEST_TOKEN?: string; }

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'vlk_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const apiKeysRouter = new Hono<{ Bindings: Env; Variables: { requestId: string; tenantId: string } }>();

apiKeysRouter.post('/', requireIngestAuth, requireTenantHeader(), async (c) => {
  const body = await c.req.json().catch(() => null) as { name?: string } | null;
  const name = String(body?.name || 'default').trim().slice(0, 120);
  if (!name) return c.json({ error: { code: 'INVALID_NAME', message: 'Key name is required', request_id: c.get('requestId') } }, 400);

  const key = randomKey();
  const hash = await sha256Hex(key);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO tenant_api_keys (id, tenant_id, key_hash, name, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)'
  ).bind(id, c.get('tenantId'), hash, name, now).run();

  return c.json({
    id,
    name,
    tenant_id: c.get('tenantId'),
    api_key: key,
    created_at: now,
    warning: 'Store this key now. The plaintext key is returned only once.',
  }, 201);
});

apiKeysRouter.get('/', requireIngestAuth, requireTenantHeader(), async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, tenant_id, name, created_at, revoked_at FROM tenant_api_keys WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(c.get('tenantId')).all<any>();
  return c.json({ items: result.results || [] });
});

apiKeysRouter.delete('/:id', requireIngestAuth, requireTenantHeader(), async (c) => {
  const result = await c.env.DB.prepare(
    'UPDATE tenant_api_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL'
  ).bind(new Date().toISOString(), c.req.param('id'), c.get('tenantId')).run();
  if (!result.meta?.changes) return c.json({ error: { code: 'KEY_NOT_FOUND', message: 'API key not found or already revoked', request_id: c.get('requestId') } }, 404);
  return c.json({ revoked: true });
});
