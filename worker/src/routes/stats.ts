import { Hono } from 'hono';
import { callRepo } from '../db';
import { WorkerEnv } from './calls';
import { requireIngestAuth, requireTenantHeader } from '../middleware/auth';

export const statsRouter = new Hono<{ Bindings: WorkerEnv; Variables: { requestId: string; tenantId: string } }>();

/**
 * GET /stats - Aggregate latency percentiles, call volume, and reliability metrics.
 * Query params: ?days=7 (1 - 90)
 */
statsRouter.get('/', requireIngestAuth, requireTenantHeader(), async (c) => {
  const daysParam = c.req.query('days');
  const days = daysParam ? parseInt(daysParam, 10) : 7;
  const safeDays = isNaN(days) ? 7 : Math.max(1, Math.min(days, 90));

  const stats = await callRepo.getStats(c.env.DB, c.get('tenantId'), safeDays);

  // Short cache to avoid recomputing on rapid consecutive requests
  c.header('Cache-Control', 'public, max-age=30, s-maxage=60');

  return c.json(stats);
});
