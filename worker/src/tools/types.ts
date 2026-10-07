import { z } from 'zod';

export const ToolDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  input_schema: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
  enabled: z.boolean().default(true),
  timeout_ms: z.number().int().positive().max(30000).default(5000),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export interface ToolContext {
  tenantId: string;
  agentId: string;
  sessionId: string;
  userId?: string;
  signal?: AbortSignal;
}

export interface ToolExecutor {
  execute(
    definition: ToolDefinition,
    input: unknown,
    context: ToolContext,
  ): Promise<unknown>;
}

export function assertToolAllowed(
  definition: ToolDefinition,
  configuredToolIds: Set<string>,
): void {
  if (!definition.enabled || !configuredToolIds.has(definition.id)) {
    throw new Error('Tool is not enabled for this agent');
  }
}
