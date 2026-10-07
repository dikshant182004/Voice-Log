import { AgentDefinition, AgentDefinitionSchema } from './types';

/**
 * Resolves and validates agent configuration once at session start.
 *
 * The real-time turn path should receive the resolved definition rather than
 * repeatedly reading remote configuration. This is a deliberate latency guard.
 */
export function resolveAgentDefinition(
  definition: unknown,
): AgentDefinition {
  return AgentDefinitionSchema.parse(definition);
}

export function mergeAgentOverrides(
  base: AgentDefinition,
  overrides: Partial<AgentDefinition>,
): AgentDefinition {
  return AgentDefinitionSchema.parse({
    ...base,
    ...overrides,
    model: { ...base.model, ...overrides.model },
    voice: overrides.voice === undefined
      ? base.voice
      : overrides.voice,
    policies: { ...base.policies, ...overrides.policies },
    memory: { ...base.memory, ...overrides.memory },
    knowledge: { ...base.knowledge, ...overrides.knowledge },
    tools: overrides.tools ?? base.tools,
    mcp_servers: overrides.mcp_servers ?? base.mcp_servers,
    metadata: { ...base.metadata, ...overrides.metadata },
  });
}
