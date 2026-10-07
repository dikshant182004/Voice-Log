import { Hono } from 'hono';
import { requireIngestAuth, requireTenantHeader } from '../middleware/auth';

interface Env {
  DB: import('../db').D1Database;
  INGEST_TOKEN?: string;
  BOT_URL?: string;
}

export const voiceRouter = new Hono<{ Bindings: Env; Variables: { requestId: string; tenantId: string } }>();
voiceRouter.post('/session', requireIngestAuth, requireTenantHeader(), async (c) => {
  const body = await c.req.json().catch(() => null) as {
    agent_id?: string;
    agent_version?: number;
    user_id?: string;
    call_id?: string;
  } | null;

  if (!body?.agent_id) {
    return c.json({ error: { code: 'AGENT_REQUIRED', message: 'agent_id is required', request_id: c.get('requestId') } }, 400);
  }
  if (!c.env.BOT_URL) {
    return c.json({ error: { code: 'VOICE_MISCONFIGURED', message: 'BOT_URL is not configured', request_id: c.get('requestId') } }, 500);
  }

  return c.json({
    offer_url: c.env.BOT_URL.replace(/\/$/, '') + '/offer',
    request_data: {
      tenant_id: c.get('tenantId'),
      agent_id: body.agent_id,
      agent_version: body.agent_version,
      user_id: body.user_id,
      call_id: body.call_id,
    },
  });
});
