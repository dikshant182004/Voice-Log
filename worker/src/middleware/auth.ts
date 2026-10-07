import { MiddlewareHandler } from 'hono';
import { logEvent } from '../lib/logger';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export const requireIngestAuth: MiddlewareHandler = async (c, next) => {
  const env = c.env as { INGEST_TOKEN?: string };
  const expectedToken = env.INGEST_TOKEN;
  const requestId = c.get('requestId') || 'req_unknown';

  if (!expectedToken) {
    logEvent('error', requestId, 'auth.misconfigured', 'INGEST_TOKEN is not configured');
    return c.json({
      error: { code: 'AUTH_MISCONFIGURED', message: 'Server authentication is not configured', request_id: requestId },
    }, 500);
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({
      error: { code: 'UNAUTHORIZED', message: 'Expected Bearer authentication', request_id: requestId },
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
