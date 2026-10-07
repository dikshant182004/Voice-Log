import { Hono } from 'hono';
import { ConnectionSchema } from '../connections/types';
import { requireIngestAuth, requireTenantHeader } from '../middleware/auth';

interface Env {
  DB: import('../db').D1Database;
  INGEST_TOKEN?: string;
}

export const connectionsRouter = new Hono<{ Bindings: Env; Variables: { requestId: string; tenantId: string } }>();

connectionsRouter.use('*', requireIngestAuth);
connectionsRouter.use('*', requireTenantHeader());

connectionsRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid connection configuration', request_id: c.get('requestId'), details: parsed.error.issues } }, 400);
  }

  const connection = parsed.data;
  await c.env.DB.prepare(
    'INSERT INTO connections (id, tenant_id, name, type, base_url, secret_ref, config_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    connection.id,
    c.get('tenantId'),
    connection.name,
    connection.type,
    connection.base_url,
    connection.secret_ref || null,
    JSON.stringify(connection.config),
    connection.enabled ? 1 : 0,
    new Date().toISOString(),
    new Date().toISOString(),
  ).run();

  return c.json(connection, 201);
});

connectionsRouter.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, name, type, base_url, secret_ref, config_json, enabled, created_at, updated_at FROM connections WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(c.get('tenantId')).all<any>();

  return c.json({
    items: (rows.results || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      base_url: row.base_url,
      secret_ref: row.secret_ref || undefined,
      config: JSON.parse(row.config_json || '{}'),
      enabled: Boolean(row.enabled),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  });
});

connectionsRouter.post('/:id/test', async (c) => {
  const row = await c.env.DB.prepare('SELECT id, name, type, base_url, secret_ref, config_json, enabled FROM connections WHERE tenant_id = ? AND id = ? LIMIT 1').bind(c.get('tenantId'), c.req.param('id')).first<any>();
  if (!row) return c.json({ error: { code: 'CONNECTION_NOT_FOUND', message: 'Connection not found', request_id: c.get('requestId') } }, 404);
  if (row.type === 'd1') return c.json({ ok: true, mode: 'managed' });
  if (!row.base_url) return c.json({ ok: false, error: 'base_url is required for this connection type' }, 400);
  const base = String(row.base_url).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const secret = row.secret_ref ? (c.env as any)['CONNECTION_SECRET_' + row.secret_ref] : undefined;
    const headers: Record<string,string> = {};
    if (secret) headers.authorization = 'Bearer ' + secret;
    const response = await fetch(base + '/health', { headers, signal: controller.signal });
    return c.json({ ok: response.ok, status: response.status, connection_id: row.id });
  } catch {
    return c.json({ ok: false, connection_id: row.id }, 502);
  } finally {
    clearTimeout(timer);
  }
});

connectionsRouter.get('/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT id, name, type, base_url, secret_ref, config_json, enabled, created_at, updated_at FROM connections WHERE tenant_id = ? AND id = ? LIMIT 1'
  ).bind(c.get('tenantId'), c.req.param('id')).first<any>();

  if (!row) return c.json({ error: { code: 'CONNECTION_NOT_FOUND', message: 'Connection not found', request_id: c.get('requestId') } }, 404);

  return c.json({
    id: row.id,
    name: row.name,
    type: row.type,
    base_url: row.base_url,
    secret_ref: row.secret_ref || undefined,
    config: JSON.parse(row.config_json || '{}'),
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
});
