import { McpServerConfig, McpTransport } from './client';

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
};

export class StreamableHttpMcpTransport implements McpTransport {
  private nextId = 1;
  private sessions = new Map<string, string>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async request(server: McpServerConfig, method: string, params: unknown, signal?: AbortSignal): Promise<any> {
    const id = this.nextId++;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    const sessionId = this.sessions.get(server.id);
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;

    const response = await this.fetchImpl(server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal,
    });

    if (!response.ok) throw new Error('MCP HTTP ' + response.status);
    const returnedSession = response.headers.get('Mcp-Session-Id');
    if (returnedSession) this.sessions.set(server.id, returnedSession);

    const text = await response.text();
    const parsed = JSON.parse(text) as JsonRpcResponse;
    if (parsed.error) throw new Error('MCP ' + parsed.error.code + ': ' + parsed.error.message);
    return parsed.result;
  }

  async listTools(server: McpServerConfig, signal?: AbortSignal): Promise<unknown[]> {
    await this.request(server, 'initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'voice-log', version: '2.0.0' },
    }, signal).catch((error) => {
      if (!String(error?.message).includes('already initialized')) throw error;
    });

    return (await this.request(server, 'tools/list', {}, signal))?.tools ?? [];
  }

  async callTool(server: McpServerConfig, name: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.request(server, 'tools/call', { name, arguments: args }, signal);
  }
}
