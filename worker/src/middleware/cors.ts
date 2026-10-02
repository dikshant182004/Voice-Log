import { MiddlewareHandler } from 'hono';

export const corsMiddleware: MiddlewareHandler = async (c, next) => {
  const env = c.env as { ALLOWED_ORIGIN?: string };
  const origin = c.req.header('Origin');
  const allowedOriginPattern = env.ALLOWED_ORIGIN || '*';

  // Determine allowed origin: allow localhost in development or matches configured origin
  let allowHeader = '*';
  if (allowedOriginPattern !== '*') {
    if (origin && (origin === allowedOriginPattern || origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      allowHeader = origin;
    } else {
      allowHeader = allowedOriginPattern;
    }
  } else if (origin) {
    allowHeader = origin;
  }

  c.res.headers.set('Access-Control-Allow-Origin', allowHeader);
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
  c.res.headers.set('Access-Control-Max-Age', '86400');

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  await next();
};
