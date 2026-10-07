import { z } from 'zod';

export const ConnectionTypeSchema = z.enum([
  'http_json',
  'vector_rest',
  'webhook',
  'd1',
]);

export const ConnectionSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  type: ConnectionTypeSchema,
  base_url: z.string().url(),
  secret_ref: z.string().min(1).max(120).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export type Connection = z.infer<typeof ConnectionSchema>;

export interface ConnectionRepository {
  get(db: import('../db').D1Database, tenantId: string, id: string): Promise<Connection | null>;
}

export const connectionRepo: ConnectionRepository = {
  async get(db, tenantId, id) {
    const row = await db.prepare(
      'SELECT id, name, type, base_url, secret_ref, config_json, enabled FROM connections WHERE tenant_id = ? AND id = ? LIMIT 1'
    ).bind(tenantId, id).first<any>();
    if (!row) return null;
    return ConnectionSchema.parse({
      id: row.id,
      name: row.name,
      type: row.type,
      base_url: row.base_url,
      secret_ref: row.secret_ref || undefined,
      config: JSON.parse(row.config_json || '{}'),
      enabled: Boolean(row.enabled),
    });
  },
};
