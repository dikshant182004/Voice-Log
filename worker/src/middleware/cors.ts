import { MiddlewareHandler } from 'hono';

const LOCALHOST_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export const corsMiddleware: MiddlewareHandler = async (c, next) => {
  const env = c.env as { ALLOWED_ORIGIN?: string; ALLOW_DEV_ORIGINS?: string };
  const origin = c.req.header('Origin');
  const configuredOrigin = (env.ALLOWED_ORIGIN || '').trim();
  const allowDev = env.ALLOW_DEV_ORIGINS !== 'false'; // default true in dev unless explicitly disabled

  let allowHeader = '';

  if (origin) {
    if (configuredOrigin && (origin === configuredOrigin || configuredOrigin === '*')) {
      allowHeader = origin;
    } else if (allowDev && LOCALHOST_REGEX.test(origin)) {
      allowHeader = origin;
    }
  }

  if (allowHeader) {
    c.res.headers.set('Access-Control-Allow-Origin', allowHeader);
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
    c.res.headers.set('Access-Control-Max-Age', '86400');
  }

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  await next();
};
