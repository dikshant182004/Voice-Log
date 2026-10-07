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
