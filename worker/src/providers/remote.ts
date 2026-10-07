import type { Connection } from '../connections/types';
import type { PolicyDefinition } from '../policy/types';
import type { KnowledgeDocument } from '../knowledge/types';

export function resolveConnectionSecret(env: Record<string, unknown>, connection: Connection): string | undefined {
  if (!connection.secret_ref) return undefined;
  const value = env['CONNECTION_SECRET_' + connection.secret_ref];
  return typeof value === 'string' && value.length ? value : undefined;
}

async function requestJson(
  env: Record<string, unknown>,
  connection: Connection,
  path: string,
  body: unknown,
  timeoutMs = 2500,
): Promise<any> {
  if (!connection.enabled) throw new Error('Connection is disabled: ' + connection.id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(250, Math.min(timeoutMs, 10000)));
  try {
    const base = connection.base_url.endsWith('/') ? connection.base_url.slice(0, -1) : connection.base_url;
    const url = base + (path.startsWith('/') ? path : '/' + path);
    const secret = resolveConnectionSecret(env, connection);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (secret) headers.authorization = 'Bearer ' + secret;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Remote connection returned HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * HTTP adapter contract for customer-owned policy/data services.
 * The customer service remains the source of truth; Voice-Log only receives
 * the minimum policy records needed by the agent.
 */
export async function fetchRemotePolicies(
  env: Record<string, unknown>,
  connection: Connection,
  input: { tenantId: string; agentId: string; policyIds: string[] },
): Promise<PolicyDefinition[]> {
  const payload = await requestJson(env, connection, '/policies/resolve', input);
  return Array.isArray(payload?.items) ? payload.items as PolicyDefinition[] : [];
}

/**
 * Generic vector/search adapter. A customer can put Pinecone/Qdrant/Weaviate
 * behind this small HTTP contract without coupling the Worker to a vendor SDK.
 */
export async function searchRemoteKnowledge(
  env: Record<string, unknown>,
  connection: Connection,
  input: { tenantId: string; agentId: string; query: string; limit: number; sourceIds?: string[] },
): Promise<KnowledgeDocument[]> {
  const payload = await requestJson(env, connection, '/search', input, 3000);
  return Array.isArray(payload?.items) ? payload.items as KnowledgeDocument[] : [];
}

export async function writeRemoteEvent(
  env: Record<string, unknown>,
  connection: Connection,
  event: Record<string, unknown>,
): Promise<void> {
  await requestJson(env, connection, '/events', event, 2500);
}

export async function recallRemoteMemory(env: Record<string, unknown>, connection: Connection, input: { tenantId: string; agentId: string; userId?: string; limit: number }) {
  const payload = await requestJson(env, connection, '/memory/recall', input, 2500);
  return Array.isArray(payload?.items) ? payload.items : [];
}

export async function writeRemoteMemory(env: Record<string, unknown>, connection: Connection, record: Record<string, unknown>) {
  await requestJson(env, connection, '/memory/write', record, 2500);
}
