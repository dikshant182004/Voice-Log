import { z } from 'zod';

/**
 * Provider-neutral agent platform contracts.
 *
 * Design rule: an AgentDefinition describes behavior/configuration; the runtime
 * owns execution. Keeping these separate lets voice, text, MCP, tools, memory,
 * and future providers share the same harness.
 */

export const AgentModelConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.2),
  max_output_tokens: z.number().int().positive().max(8192).default(256),
  reasoning_effort: z.enum(['none', 'low', 'medium', 'high']).default('low'),
});

export const AgentVoiceConfigSchema = z.object({
  provider: z.string().min(1),
  voice_id: z.string().min(1),
  sample_rate: z.number().int().positive().default(24000),
  language: z.string().min(2).default('en-US'),
});

export const AgentPolicyConfigSchema = z.object({
  policy_ids: z.array(z.string().min(1)).default([]),
  max_response_tokens: z.number().int().positive().max(4096).default(256),
  allow_external_tools: z.boolean().default(false),
  allow_memory_write: z.boolean().default(true),
});

export const AgentToolConfigSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  timeout_ms: z.number().int().positive().max(30000).default(5000),
});

export const AgentMemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  session_max_turns: z.number().int().positive().max(100).default(12),
  long_term_retrieval_limit: z.number().int().nonnegative().max(20).default(5),
});

export const AgentKnowledgeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  source_ids: z.array(z.string().min(1)).default([]),
  retrieval_limit: z.number().int().positive().max(20).default(5),
});

export const AgentMcpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  enabled: z.boolean().default(true),
});

export const AgentDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  system_instructions: z.string().min(1).max(30000),
  persona: z.string().max(4000).default(''),
  model: AgentModelConfigSchema,
  voice: AgentVoiceConfigSchema.nullable().default(null),
  policies: AgentPolicyConfigSchema.default({}),
  tools: z.array(AgentToolConfigSchema).default([]),
  mcp_servers: z.array(AgentMcpServerSchema).default([]),
  memory: AgentMemoryConfigSchema.default({}),
  knowledge: AgentKnowledgeConfigSchema.default({}),
  metadata: z.record(z.string(), z.string()).default({}),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export type AgentModelConfig = z.infer<typeof AgentModelConfigSchema>;

export interface AgentRequestContext {
  requestId: string;
  tenantId: string;
  agentId: string;
  agentVersion: number;
  sessionId: string;
  userId?: string;
  channel: 'voice' | 'text';
  signal?: AbortSignal;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface AgentStreamEvent {
  type:
    | 'response.start'
    | 'response.delta'
    | 'response.end'
    | 'tool.start'
    | 'tool.end'
    | 'error';
  requestId: string;
  text?: string;
  toolId?: string;
  error?: string;
  timestampMs: number;
}

export interface AgentRuntime {
  execute(
    request: AgentRequestContext,
    input: AgentMessage,
    definition: AgentDefinition,
  ): AsyncIterable<AgentStreamEvent>;
}
