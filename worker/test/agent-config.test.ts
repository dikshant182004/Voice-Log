import { describe, expect, it } from 'vitest';
import { mergeAgentOverrides, resolveAgentDefinition } from '../src/agents/config';

const base = {
  id: 'marketing',
  version: 1,
  name: 'Marketing Agent',
  description: 'Company marketing assistant',
  system_instructions: 'Be concise and factual.',
  persona: 'Helpful marketing strategist.',
  model: {
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    temperature: 0.2,
    max_output_tokens: 256,
    reasoning_effort: 'low' as const,
  },
  voice: {
    provider: 'cartesia',
    voice_id: 'demo',
    sample_rate: 24000,
    language: 'en-US',
  },
  policies: {},
  tools: [],
  mcp_servers: [],
  memory: {},
  knowledge: {},
  metadata: {},
};

describe('agent config', () => {
  it('validates a complete definition and applies defaults', () => {
    const resolved = resolveAgentDefinition(base);
    expect(resolved.policies.max_response_tokens).toBe(256);
    expect(resolved.memory.session_max_turns).toBe(12);
  });

  it('merges nested overrides without mutating the base', () => {
    const resolved = mergeAgentOverrides(base, {
      model: { temperature: 0.4 },
      memory: { long_term_retrieval_limit: 8 },
    });

    expect(resolved.model.temperature).toBe(0.4);
    expect(resolved.model.model).toBe(base.model.model);
    expect(resolved.memory.long_term_retrieval_limit).toBe(8);
    expect(resolved.memory.session_max_turns).toBe(12);
    expect(base.model.temperature).toBe(0.2);
  });
});
