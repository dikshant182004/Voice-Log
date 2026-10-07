import type { AgentDefinition } from '../agents/types';
import { connectionRepo } from '../connections/types';
import { D1MemoryStore } from '../memory/d1';
import type { MemoryStore } from '../memory/types';
import { D1KnowledgeRetriever } from '../knowledge/d1';
import type { KnowledgeRetriever } from '../knowledge/types';
import { fetchRemotePolicies, searchRemoteKnowledge } from './remote';
import { loadPolicies } from '../policy/repository';
import type { PolicyRecord } from '../policy/types';

export async function resolvePolicyProvider(
  db: import('../db').D1Database,
  env: Record<string, unknown>,
  tenantId: string,
  definition: AgentDefinition,
): Promise<PolicyRecord[]> {
  const ref = definition.data?.policy_connection_id;
  if (!ref) return loadPolicies(db, tenantId, definition.policies.policy_ids);
  const connection = await connectionRepo.get(db, tenantId, ref);
  if (!connection) throw new Error('Policy connection not found: ' + ref);
  return fetchRemotePolicies(env, connection, {
    tenantId,
    agentId: definition.id,
    policyIds: definition.policies.policy_ids,
  });
}

export async function resolveMemoryProvider(
  db: import('../db').D1Database,
  tenantId: string,
  definition: AgentDefinition,
): Promise<MemoryStore> {
  const ref = definition.data?.memory_connection_id;
  if (!ref) return new D1MemoryStore(db);
  throw new Error('Custom memory connections currently require a compatible adapter; connection=' + ref);
}

export async function resolveKnowledgeProvider(
  db: import('../db').D1Database,
  env: Record<string, unknown>,
  tenantId: string,
  definition: AgentDefinition,
): Promise<KnowledgeRetriever> {
  const ref = definition.data?.knowledge_connection_id;
  if (!ref) return new D1KnowledgeRetriever(db);
  const connection = await connectionRepo.get(db, tenantId, ref);
  if (!connection) throw new Error('Knowledge connection not found: ' + ref);
  return {
    async search(input) {
      return searchRemoteKnowledge(env, connection, input);
    },
  };
}
