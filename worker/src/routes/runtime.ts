import { Hono } from 'hono';
import { z } from 'zod';
import { agentRepo } from '../agents/repository';
import { resolvePolicyInstructions } from '../policy/types';
import { buildMemoryContext } from '../memory/types';
import { buildKnowledgeContext } from '../knowledge/types';
import { generateGroqResponse } from '../runtime/groq';
import { requireIngestAuth, requireTenantHeader } from '../middleware/auth';
import { resolvePolicyProvider, resolveMemoryProvider, resolveKnowledgeProvider } from '../providers/resolve';
import { connectionRepo } from '../connections/types';
import { writeRemoteEvent } from '../providers/remote';

interface Env {
  DB: import('../db').D1Database;
  INGEST_TOKEN?: string;
  GROQ_API_KEY?: string;
}

const RequestSchema = z.object({
  agent_id: z.string().min(1),
  agent_version: z.number().int().positive().optional(),
  user_id: z.string().min(1).max(256).optional(),
  session_id: z.string().min(1).max(256).optional(),
  message: z.string().min(1).max(20000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(20000),
  })).max(24).default([]),
});

export const runtimeRouter = new Hono<{ Bindings: Env; Variables: { requestId: string; tenantId: string } }>();
runtimeRouter.use('*', requireIngestAuth);
runtimeRouter.use('*', requireTenantHeader());

runtimeRouter.post('/respond', async (c) => {
  const startedAt = performance.now();
  const parsed = RequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid runtime request', request_id: c.get('requestId'), details: parsed.error.issues } }, 400);
  }

  if (!c.env.GROQ_API_KEY) {
    return c.json({ error: { code: 'RUNTIME_MISCONFIGURED', message: 'GROQ_API_KEY is not configured', request_id: c.get('requestId') } }, 500);
  }

  const body = parsed.data;
  const stored = await agentRepo.get(c.env.DB, c.get('tenantId'), body.agent_id, body.agent_version, true);
  if (!stored) {
    return c.json({ error: { code: 'AGENT_NOT_FOUND', message: 'Published agent version not found', request_id: c.get('requestId') } }, 404);
  }

  const definition = stored.definition;
  if (definition.model.provider !== 'groq') {
    return c.json({ error: { code: 'PROVIDER_UNSUPPORTED', message: 'The Worker runtime currently supports provider=groq; voice adapters remain provider-neutral', request_id: c.get('requestId') } }, 422);
  }

  const policies = await resolvePolicyProvider(c.env.DB, c.env as unknown as Record<string, unknown>, c.get('tenantId'), definition);
  const effectiveDefinition = {
    ...definition,
    model: {
      ...definition.model,
      max_output_tokens: Math.min(definition.model.max_output_tokens, definition.policies.max_response_tokens),
    },
  };
  const memoryStore = await resolveMemoryProvider(c.env.DB, c.env as unknown as Record<string, unknown>, c.get('tenantId'), definition);
  const memories = definition.memory.enabled
    ? await memoryStore.recall({
        tenantId: c.get('tenantId'),
        agentId: definition.id,
        userId: body.user_id,
        limit: definition.memory.long_term_retrieval_limit,
      })
    : [];
  const knowledge = definition.knowledge.enabled
    ? await (await resolveKnowledgeProvider(c.env.DB, c.env as unknown as Record<string, unknown>, c.get('tenantId'), definition)).search({
        tenantId: c.get('tenantId'),
        agentId: definition.id,
        query: body.message,
        limit: definition.knowledge.retrieval_limit,
        sourceIds: definition.knowledge.source_ids,
      })
    : [];

  const env = c.env as Env & Record<string, unknown>;
  const mcpAuthorizations = Object.fromEntries(
    definition.mcp_servers
      .filter((server) => server.enabled && server.auth_ref)
      .map((server) => [server.auth_ref as string, String(env['MCP_AUTH_' + c.get('tenantId') + '_' + server.auth_ref!] || '')])
      .filter(([, value]) => Boolean(value))
  );

  const result = await generateGroqResponse(c.env.GROQ_API_KEY, effectiveDefinition, {
    message: body.message,
    history: body.history,
    memories: buildMemoryContext(memories),
    knowledge: buildKnowledgeContext(knowledge),
    policyInstructions: resolvePolicyInstructions(policies),
  }, mcpAuthorizations);

  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
  const usage = result.usage || {};
  const persistRun = c.env.DB.prepare(
    'INSERT INTO agent_runs (id, tenant_id, agent_id, agent_version, user_id, session_id, channel, status, latency_ms, input_tokens, output_tokens, provider_request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(),
    c.get('tenantId'),
    definition.id,
    definition.version,
    body.user_id || null,
    body.session_id || null,
    'text',
    'completed',
    latencyMs,
    Number(usage.input_tokens || 0),
    Number(usage.output_tokens || 0),
    result.provider_request_id || null,
    new Date().toISOString(),
  ).run();
  const executionCtx = c.executionCtx as { waitUntil?: (promise: Promise<unknown>) => void };
  executionCtx?.waitUntil?.(persistRun);

  const persistExternalRun = async () => {
    if (!definition.observability.enabled || !definition.observability.connection_id || definition.observability.mode === 'd1' || !definition.observability.events.includes('agent_run')) return;
    const connection = await connectionRepo.get(c.env.DB, c.get('tenantId'), definition.observability.connection_id);
    if (!connection || connection.type !== 'webhook') return;
    const event = {
      event: 'agent_run',
      created_at: new Date().toISOString(),
      fields: Object.fromEntries(
        definition.observability.fields.map((field) => [field, ({
          call_id: body.session_id || null,
          agent_id: definition.id,
          agent_version: definition.version,
          duration_ms: null,
          latency_ms: latencyMs,
          status: 'completed',
          usage: result.usage || null,
          user_id: body.user_id || null,
          session_id: body.session_id || null,
          provider_request_id: result.provider_request_id || null,
          channel: 'text',
        } as Record<string, unknown>)[field]]).filter(([, value]) => value !== undefined)
      ),
    };
    await writeRemoteEvent(c.env as unknown as Record<string, unknown>, connection, event);
  };
  executionCtx?.waitUntil?.(persistExternalRun());

  const persistMemory = async () => {
    if (!definition.memory.enabled || !definition.policies.allow_memory_write) return;
    const sessionId = body.session_id || body.user_id;
    if (!sessionId) return;
    const base = {
      tenant_id: c.get('tenantId'),
      agent_id: definition.id,
      user_id: body.user_id,
      session_id: sessionId,
      kind: 'session' as const,
      importance: 0.2,
      metadata: {},
    };
    await memoryStore.write({ id: crypto.randomUUID(), ...base, content: 'User: ' + body.message });
    if (result.text) {
      await memoryStore.write({ id: crypto.randomUUID(), ...base, content: 'Assistant: ' + result.text });
    }
  };
  executionCtx?.waitUntil?.(persistMemory());

  return c.json({
    request_id: c.get('requestId'),
    agent: { id: definition.id, version: definition.version },
    response: result.text,
    usage: result.usage || null,
    provider_request_id: result.provider_request_id || null,
    latency_ms: latencyMs,
    retrieval: { memories: memories.length, knowledge: knowledge.length, policies: policies.length },
  });
});
