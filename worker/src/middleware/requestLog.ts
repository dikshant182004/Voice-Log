import { MiddlewareHandler } from 'hono';
import { generateRequestId } from '../lib/ids';
import { logRequest } from '../lib/logger';

export const requestLogMiddleware: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  const incomingRequestId = c.req.header('X-Request-ID');
  const requestId = incomingRequestId || generateRequestId();
  c.set('requestId', requestId);
  c.res.headers.set('X-Request-ID', requestId);

  try {
    await next();
  } finally {
    const duration = performance.now() - start;
    const status = c.res.status;
    const callId = c.get('callId');
    const errorCode = c.get('errorCode');

    // Use c.req.routePath (set after routing completes) or the last matched route
    let routePattern = c.req.routePath;
    if (!routePattern || routePattern === '/*') {
      if (c.req.matchedRoutes && c.req.matchedRoutes.length > 0) {
        // Pick the last matched route (the specific route, not the global /* middleware)
        const last = c.req.matchedRoutes[c.req.matchedRoutes.length - 1];
        routePattern = last.path;
      }
    }
    if (!routePattern || routePattern === '/*') {
      routePattern = c.req.path;
    }

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
