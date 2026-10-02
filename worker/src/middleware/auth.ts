import { MiddlewareHandler } from 'hono';
import { logEvent } from '../lib/logger';

/**
 * Constant-time comparison to prevent timing attacks on token verification.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export const requireIngestAuth: MiddlewareHandler = async (c, next) => {
  const env = c.env as { INGEST_TOKEN?: string };
  // Fall back to standard development ingest token if not explicitly configured in environment
  const expectedToken = env.INGEST_TOKEN || 'secret_ingest_token_12345';
  const requestId = c.get('requestId') || 'req_unknown';

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header. Expected Bearer <token>',
          request_id: requestId,
        },
      },
      401
    );
  }

  const token = authHeader.substring(7).trim();
  if (!timingSafeEqual(token, expectedToken)) {
    return c.json(
      {
        error: {
          code: 'INVALID_TOKEN',
          message: 'Provided ingest token is invalid',
          request_id: requestId,
        },
      },
      401
    );
  }

  await next();
};
