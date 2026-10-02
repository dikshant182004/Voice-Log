import { MiddlewareHandler } from 'hono';
import { generateRequestId } from '../lib/ids';
import { logRequest } from '../lib/logger';

export const requestLogMiddleware: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  const incomingRequestId = c.req.header('X-Request-ID');
  const requestId = incomingRequestId || generateRequestId();
  c.set('requestId', requestId);
  c.res.headers.set('X-Request-ID', requestId);

  let routePattern = c.req.path;
  if (c.req.matchedRoutes && c.req.matchedRoutes.length > 0) {
    routePattern = c.req.matchedRoutes[0].path;
  }

  try {
    await next();
  } finally {
    const duration = performance.now() - start;
    const status = c.res.status;
    const callId = c.get('callId');
    const errorCode = c.get('errorCode');

    logRequest(
      requestId,
      c.req.method,
      routePattern,
      status,
      duration,
      callId,
      errorCode
    );
  }
};
