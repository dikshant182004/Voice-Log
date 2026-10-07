import { z } from 'zod';

export const McpServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  enabled: z.boolean().default(true),
  timeout_ms: z.number().int().positive().max(30000).default(5000),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export interface McpTransport {
  listTools(server: McpServerConfig, signal?: AbortSignal): Promise<unknown[]>;
  callTool(server: McpServerConfig, name: string, args: unknown, signal?: AbortSignal): Promise<unknown>;
}

/**
 * Protocol boundary only. Transport/auth implementation can be swapped
 * without changing AgentRuntime or the tool registry.
 */
export class McpClient {
  constructor(private readonly transport: McpTransport) {}

  listTools(server: McpServerConfig, signal?: AbortSignal) {
    return this.transport.listTools(server, signal);
  }

  callTool(server: McpServerConfig, name: string, args: unknown, signal?: AbortSignal) {
    return this.transport.callTool(server, name, args, signal);
  }
}
