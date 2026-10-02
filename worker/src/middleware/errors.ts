import { ErrorHandler, NotFoundHandler } from 'hono';
import { ZodError } from 'zod';
import { logEvent } from '../lib/logger';

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') || 'req_err';
  const callId = c.get('callId');

  if (err instanceof ZodError) {
    c.set('errorCode', 'VALIDATION_ERROR');
    logEvent('warn', requestId, 'call.validation_failed', 'Request failed validation', {
      callId,
      errorCode: 'VALIDATION_ERROR',
      metadata: { issues: err.issues },
    });
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request payload failed schema validation',
          request_id: requestId,
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      400
    );
  }

  c.set('errorCode', 'INTERNAL_SERVER_ERROR');
  console.error(`[Unhandled Error] [${requestId}]:`, err);

  return c.json(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An internal server error occurred',
        request_id: requestId,
      },
    },
    500
  );
};

export const notFoundHandler: NotFoundHandler = (c) => {
  const requestId = c.get('requestId') || 'req_404';
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${c.req.method} ${c.req.path}`,
        request_id: requestId,
      },
    },
    404
  );
};
