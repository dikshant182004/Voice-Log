import { MiddlewareHandler } from 'hono';
import { logEvent } from '../lib/logger';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const requireIngestAuth: MiddlewareHandler = async (c, next) => {
  const env = c.env as { INGEST_TOKEN?: string; DB?: any };
  const requestId = c.get('requestId') || 'req_unknown';
  const apiKey = c.req.header('X-API-Key')?.trim();

  if (apiKey) {
    if (!env.DB) {
      return c.json({ error: { code: 'AUTH_MISCONFIGURED', message: 'API key storage is not configured', request_id: requestId } }, 500);
    }
    const keyHash = await sha256Hex(apiKey);
    const row = await env.DB.prepare(
      'SELECT tenant_id FROM tenant_api_keys WHERE key_hash = ? AND revoked_at IS NULL LIMIT 1'
    ).bind(keyHash).first<any>();
    if (!row?.tenant_id) {
      return c.json({ error: { code: 'INVALID_API_KEY', message: 'Provided API key is invalid or revoked', request_id: requestId } }, 401);
    }
    c.set('tenantId', row.tenant_id);
    await next();
    return;
  }

  const expectedToken = env.INGEST_TOKEN;
  if (!expectedToken) {
    logEvent('error', requestId, 'auth.misconfigured', 'INGEST_TOKEN is not configured');
    return c.json({
      error: { code: 'AUTH_MISCONFIGURED', message: 'Server authentication is not configured', request_id: requestId },
    }, 500);
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({
      error: { code: 'UNAUTHORIZED', message: 'Expected Bearer authentication or X-API-Key', request_id: requestId },
    }, 401);
  }

  const token = authHeader.slice(7).trim();
  if (!token || !timingSafeEqual(token, expectedToken)) {
    return c.json({
      error: { code: 'INVALID_TOKEN', message: 'Provided token is invalid', request_id: requestId },
    }, 401);
  }

  await next();
};

export function requireTenantHeader(): MiddlewareHandler {
  return async (c, next) => {
    if (c.get('tenantId')) {
      await next();
      return;
    }
    const tenantId = c.req.header('X-Tenant-ID')?.trim();
    if (!tenantId || tenantId.length > 128) {
      return c.json({
        error: { code: 'TENANT_REQUIRED', message: 'X-Tenant-ID is required', request_id: c.get('requestId') || 'req_unknown' },
      }, 400);
    }
    c.set('tenantId', tenantId);
    await next();
  };
}

export { sha256Hex };
