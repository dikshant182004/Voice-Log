import { describe, expect, it } from 'vitest';
import { resolvePolicyInstructions } from '../src/policy/types';
import { buildMemoryContext } from '../src/memory/types';
import { buildKnowledgeContext } from '../src/knowledge/types';

describe('platform context', () => {
  it('resolves policies deterministically by priority', () => {
    const text = resolvePolicyInstructions([{
      id: 'brand', version: 1, name: 'Brand',
      rules: [
        { id: 'b', priority: 20, instruction: 'be concise', mode: 'prefer' },
        { id: 'a', priority: 10, instruction: 'do not invent prices', mode: 'must_not' },
      ],
    }]);
    expect(text.indexOf('do not invent prices')).toBeLessThan(text.indexOf('be concise'));
  });

  it('bounds memory and knowledge context', () => {
    const memory = buildMemoryContext([{
      id: 'm1', tenant_id: 't', agent_id: 'a', kind: 'fact',
      content: 'customer prefers email', importance: 0.9, metadata: {},
    }], 100);
    const knowledge = buildKnowledgeContext([{
      id: 'd1', tenant_id: 't', source_id: 's', title: 'FAQ',
      content: 'refunds are available within 30 days', metadata: {},
    }], 100);
    expect(memory).toContain('customer prefers email');
    expect(knowledge).toContain('refunds are available within 30 days');
  });
});
