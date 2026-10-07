import { z } from 'zod';

export const MemoryRecordSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  agent_id: z.string().min(1),
  user_id: z.string().optional(),
  session_id: z.string().optional(),
  kind: z.enum(['session', 'preference', 'fact', 'summary']),
  content: z.string().min(1).max(10000),
  importance: z.number().min(0).max(1).default(0.5),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export interface MemoryStore {
  recall(input: {
    tenantId: string;
    agentId: string;
    userId?: string;
    limit: number;
  }): Promise<MemoryRecord[]>;
  write(record: MemoryRecord): Promise<void>;
}

export function buildMemoryContext(memories: MemoryRecord[], maxChars = 12000): string {
  return memories
    .sort((a, b) => b.importance - a.importance)
    .map((memory) => '- ' + memory.content)
    .join('\n')
    .slice(0, maxChars);
}
