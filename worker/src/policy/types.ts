import { z } from 'zod';

export const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  priority: z.number().int().default(100),
  instruction: z.string().min(1).max(5000),
  mode: z.enum(['must', 'must_not', 'prefer']).default('prefer'),
});

export const PolicyDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1).max(120),
  rules: z.array(PolicyRuleSchema).max(100),
});

export type PolicyDefinition = z.infer<typeof PolicyDefinitionSchema>;

export function resolvePolicyInstructions(policies: PolicyDefinition[]): string {
  return policies
    .flatMap((policy) => policy.rules.map((rule) => ({ ...rule, policyId: policy.id })))
    .sort((a, b) => a.priority - b.priority)
    .map((rule) => '[Policy ' + rule.policyId + '] ' +
      (rule.mode === 'must_not' ? 'Do not' : rule.mode === 'must' ? 'You must' : 'Prefer') +
      ': ' + rule.instruction)
    .join('\n');
}
