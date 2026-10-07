import { ToolDefinition, ToolExecutor, ToolContext, assertToolAllowed } from './types';

export class SafeToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly executors = new Map<string, ToolExecutor>();

  register(definition: ToolDefinition, executor: ToolExecutor): void {
    if (this.definitions.has(definition.id)) {
      throw new Error('Tool already registered: ' + definition.id);
    }
    this.definitions.set(definition.id, definition);
    this.executors.set(definition.id, executor);
  }

  get(id: string): ToolDefinition | undefined {
    return this.definitions.get(id);
  }

  async execute(id: string, input: unknown, context: ToolContext, configuredToolIds: Set<string>): Promise<unknown> {
    const definition = this.definitions.get(id);
    const executor = this.executors.get(id);
    if (!definition || !executor) throw new Error('Unknown tool: ' + id);

    assertToolAllowed(definition, configuredToolIds);

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), definition.timeout_ms);
    try {
      return await executor.execute(definition, input, { ...context, signal: timeout.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
