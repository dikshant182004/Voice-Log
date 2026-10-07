import { Hono } from 'hono';
import { WorkerEnv, callsRouter } from './routes/calls';
import { statsRouter } from './routes/stats';
import { agentsRouter } from './routes/agents';
import { corsMiddleware } from './middleware/cors';
import { requestLogMiddleware } from './middleware/requestLog';
import { errorHandler, notFoundHandler } from './middleware/errors';

/**
 * Cloudflare Worker API entrypoint.
 * Modular Hono architecture: wires middleware, sub-routers, error handlers.
 */
const app = new Hono<{ Bindings: WorkerEnv; Variables: { requestId: string; callId?: string; errorCode?: string } }>();

// Global Middlewares
app.use('*', corsMiddleware);
app.use('*', requestLogMiddleware);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'mini-call-log-worker', timestamp: new Date().toISOString() });
});

// Mounted Routes
app.route('/calls', callsRouter);
app.route('/stats', statsRouter);
app.route('/agents', agentsRouter);

// Global Error and Not Found Handlers
app.onError(errorHandler);
app.notFound(notFoundHandler);

export default app;
