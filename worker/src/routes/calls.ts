import { Hono } from 'hono';
import { D1Database } from '../db';
import { callRepo } from '../db';
import { isValidUuid } from '../lib/ids';
import { logEvent } from '../lib/logger';
import { requireIngestAuth } from '../middleware/auth';
import { PostCallPayloadSchema } from '../schemas';
import { runPostCallJudge } from '../evals/postCallJudge';

export interface WorkerEnv {
  DB: D1Database;
  INGEST_TOKEN?: string;
  GROQ_API_KEY?: string;
  ALLOWED_ORIGIN?: string;
  ALLOW_DEV_ORIGINS?: string;
}

export const callsRouter = new Hono<{ Bindings: WorkerEnv; Variables: { requestId: string; callId?: string } }>();

const MAX_BODY_BYTES = 512 * 1024; // 512 KB

/**
 * POST /calls - Save a finished call record.
 * Authenticated via Bearer <INGEST_TOKEN>.
 * Atomic & Idempotent: safe to retry if network dropped.
 */
callsRouter.post('/', requireIngestAuth, async (c) => {
  const requestId = c.get('requestId');

  // Enforce body size limit
  const contentLength = parseInt(c.req.header('Content-Length') || '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return c.json(
      {
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds maximum size of ${MAX_BODY_BYTES / 1024}KB`,
          request_id: requestId,
        },
      },
      413
    );
  }

  const rawBody = await c.req.json().catch(() => null);

  if (!rawBody) {
    return c.json(
      {
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
          request_id: requestId,
        },
      },
      400
    );
  }

  // Validate payload against single source of truth Zod schema
  const parsed = PostCallPayloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Payload failed schema validation',
          request_id: requestId,
          details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      400
    );
  }

  const payload = parsed.data;
  c.set('callId', payload.call_id);

  logEvent('info', requestId, 'call.received', 'Received call payload for ingestion', {
    callId: payload.call_id,
    metadata: {
      status: payload.status,
      duration_ms: payload.duration_ms,
      turns: payload.transcript.length,
    },
  });

  const { duplicate, callId } = await callRepo.insertCall(c.env.DB, payload);

  if (duplicate) {
    logEvent('info', requestId, 'call.duplicate', 'Call was already ingested (idempotent no-op)', { callId });
    return c.json({ id: callId, duplicate: true }, 200);
  }

  logEvent('info', requestId, 'call.persisted', 'Successfully persisted call record and metrics to D1', { callId });

  // Advanced Feature 2: Trigger post-call judge asynchronously without delaying response
  try {
    const executionCtx = c.executionCtx as { waitUntil?: (promise: Promise<any>) => void } | undefined;
    if (executionCtx && typeof executionCtx.waitUntil === 'function') {
      executionCtx.waitUntil(
        runPostCallJudge(c.env, callId, requestId, payload.transcript)
      );
    } else {
      runPostCallJudge(c.env, callId, requestId, payload.transcript).catch(() => {});
    }
  } catch (err) {
    // waitUntil invocation error should never fail the call ingestion response
  }

  return c.json({ id: callId }, 201);
});

/**
 * GET /calls - List calls with cursor-based pagination.
 * Excludes full transcripts for efficiency.
 */
callsRouter.get('/', async (c) => {
  const limitParam = c.req.query('limit');
  const cursorParam = c.req.query('cursor');

  const limit = limitParam ? parseInt(limitParam, 10) : 20;
  const safeLimit = isNaN(limit) ? 20 : limit;

  const result = await callRepo.listCalls(c.env.DB, safeLimit, cursorParam);
  return c.json(result);
});

/**
 * GET /calls/:id - Get detailed call record including transcript, metrics, and evals.
 */
callsRouter.get('/:id', async (c) => {
  const requestId = c.get('requestId');
  const id = c.req.param('id');

  if (!isValidUuid(id)) {
    return c.json(
      {
        error: {
          code: 'INVALID_ID',
          message: 'Call ID must be a valid UUID',
          request_id: requestId,
        },
      },
      400
    );
  }

  const detail = await callRepo.getCallById(c.env.DB, id);
  if (!detail) {
    return c.json(
      {
        error: {
          code: 'CALL_NOT_FOUND',
          message: `No call found with ID ${id}`,
          request_id: requestId,
        },
      },
      404
    );
  }

  return c.json(detail);
});
