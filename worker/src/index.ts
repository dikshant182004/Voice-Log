import { Hono } from 'hono';
import { WorkerEnv, callsRouter } from './routes/calls';
import { statsRouter } from './routes/stats';
import { agentsRouter } from './routes/agents';
import { apiKeysRouter } from './routes/apiKeys';
import { policiesRouter } from './routes/policies';
import { memoryRouter } from './routes/memory';
import { knowledgeRouter } from './routes/knowledge';
import { toolsRouter } from './routes/tools';
import { mcpRouter } from './routes/mcp';
import { runtimeRouter } from './routes/runtime';
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
app.route('/api-keys', apiKeysRouter);
app.route('/policies', policiesRouter);
app.route('/memory', memoryRouter);
app.route('/knowledge', knowledgeRouter);
app.route('/tools', toolsRouter);
app.route('/mcp', mcpRouter);
app.route('/runtime', runtimeRouter);

// Versioned public API. Legacy routes remain mounted for existing clients.
app.route('/v1/calls', callsRouter);
app.route('/v1/stats', statsRouter);
app.route('/v1/agents', agentsRouter);
app.route('/v1/api-keys', apiKeysRouter);
app.route('/v1/policies', policiesRouter);
app.route('/v1/memory', memoryRouter);
app.route('/v1/knowledge', knowledgeRouter);
app.route('/v1/tools', toolsRouter);
app.route('/v1/mcp', mcpRouter);
app.route('/v1/runtime', runtimeRouter);

// Global Error and Not Found Handlers
app.onError(errorHandler);
app.notFound(notFoundHandler);

export default app;
