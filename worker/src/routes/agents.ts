import { Hono } from 'hono';
import { agentRepo } from '../agents/repository';
import { AgentDefinitionSchema } from '../agents/types';
import { requireIngestAuth, requireTenantHeader } from '../middleware/auth';

interface Env {
  DB: import('../db').D1Database;
  INGEST_TOKEN?: string;
}

export const agentsRouter = new Hono<{ Bindings: Env; Variables: { requestId: string; tenantId: string } }>();

agentsRouter.use('*', requireIngestAuth);
agentsRouter.use('*', requireTenantHeader());

agentsRouter.post('/', async (c) => {
  const tenant = c.get('tenantId');
  const body = await c.req.json().catch(() => null);
  const parsed = AgentDefinitionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Agent definition failed schema validation',
        request_id: c.get('requestId'),
        details: parsed.error.issues,
      },
    }, 400);
  }

  try {
    const agent = await agentRepo.create(c.env.DB, tenant, parsed.data);
    return c.json(agent, 201);
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.includes('UNIQUE') || message.includes('constraint')) {
      return c.json({ error: { code: 'AGENT_VERSION_EXISTS', message: 'That agent version already exists', request_id: c.get('requestId') } }, 409);
    }
    throw error;
  }
});

agentsRouter.get('/:id', async (c) => {
  const versionParam = c.req.query('version');
  const version = versionParam === undefined ? undefined : Number(versionParam);

  if (versionParam !== undefined && (!Number.isInteger(version) || version < 1)) {
    return c.json({ error: { code: 'INVALID_VERSION', message: 'version must be a positive integer', request_id: c.get('requestId') } }, 400);
  }

  const agent = await agentRepo.get(c.env.DB, c.get('tenantId'), c.req.param('id'), version);
  if (!agent) return c.json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found', request_id: c.get('requestId') } }, 404);
  return c.json(agent);
});

agentsRouter.post('/:id/versions/:version/publish', async (c) => {
  const version = Number(c.req.param('version'));
  if (!Number.isInteger(version) || version < 1) {
    return c.json({ error: { code: 'INVALID_VERSION', message: 'version must be a positive integer', request_id: c.get('requestId') } }, 400);
  }

  const agent = await agentRepo.publish(c.env.DB, c.get('tenantId'), c.req.param('id'), version);
  if (!agent) return c.json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent version not found', request_id: c.get('requestId') } }, 404);
  return c.json(agent);
});
