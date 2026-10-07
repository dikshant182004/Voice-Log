import { D1Database } from '../db';
import { PolicyDefinition, PolicyDefinitionSchema } from './types';

export async function loadPolicies(
  db: D1Database,
  tenantId: string,
  policyIds: string[],
): Promise<PolicyDefinition[]> {
  if (!policyIds.length) return [];
  const placeholders = policyIds.map(() => '?').join(',');
  const result = await db.prepare(
    'SELECT id, version, name, rules_json FROM agent_policies WHERE tenant_id = ? AND id IN (' + placeholders + ') ORDER BY version DESC'
  ).bind(tenantId, ...policyIds).all<any>();

  const latest = new Map<string, PolicyDefinition>();
  for (const row of result.results || []) {
    if (latest.has(row.id)) continue;
    latest.set(row.id, PolicyDefinitionSchema.parse({
      id: row.id,
      version: Number(row.version),
      name: row.name,
      rules: JSON.parse(row.rules_json || '[]'),
    }));
  }
  return [...latest.values()];
}
