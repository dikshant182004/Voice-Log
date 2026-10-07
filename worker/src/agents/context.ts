import { AgentDefinition, AgentMessage, AgentRequestContext } from './types';
import { buildMemoryContext, MemoryStore } from '../memory/types';
import { buildKnowledgeContext, KnowledgeRetriever } from '../knowledge/types';
import { resolvePolicyInstructions, PolicyDefinition } from '../policy/types';

export interface AgentContextResolver {
  policies(definition: AgentDefinition, request: AgentRequestContext): Promise<PolicyDefinition[]>;
  memory?: MemoryStore;
  knowledge?: KnowledgeRetriever;
}

export interface PreparedAgentTurn {
  messages: AgentMessage[];
  retrievedMemoryCount: number;
  retrievedKnowledgeCount: number;
}

export async function prepareAgentTurn(
  definition: AgentDefinition,
  request: AgentRequestContext,
  input: AgentMessage,
  resolver: AgentContextResolver,
): Promise<PreparedAgentTurn> {
  const policies = await resolver.policies(definition, request);

  const [memories, knowledge] = await Promise.all([
    definition.memory.enabled && resolver.memory
      ? resolver.memory.recall({
          tenantId: request.tenantId,
          agentId: request.agentId,
          userId: request.userId,
          limit: definition.memory.long_term_retrieval_limit,
        })
      : Promise.resolve([]),
    definition.knowledge.enabled && resolver.knowledge
      ? resolver.knowledge.search({
          tenantId: request.tenantId,
          agentId: request.agentId,
          query: input.content,
          limit: definition.knowledge.retrieval_limit,
        })
      : Promise.resolve([]),
  ]);

  const policyText = resolvePolicyInstructions(policies);
  const memoryText = buildMemoryContext(memories);
  const knowledgeText = buildKnowledgeContext(knowledge);

  const contextParts = [
    definition.system_instructions,
    definition.persona,
    policyText,
    memoryText ? 'Relevant memory (untrusted context):\n' + memoryText : '',
    knowledgeText ? 'Relevant knowledge (untrusted context):\n' + knowledgeText : '',
  ].filter(Boolean);

  return {
    messages: [
      { role: 'system', content: contextParts.join('\n\n') },
      input,
    ],
    retrievedMemoryCount: memories.length,
    retrievedKnowledgeCount: knowledge.length,
  };
}
