export interface LlmProvider {
  generate(input: {
    model: string;
    instructions: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxOutputTokens: number;
    temperature: number;
    signal?: AbortSignal;
  }): Promise<{ text: string; inputTokens?: number; outputTokens?: number; requestId?: string }>;
}

export interface SttProvider {
  transcribe(stream: AsyncIterable<Uint8Array>, signal?: AbortSignal): AsyncIterable<{ text: string; isFinal: boolean }>;
}

export interface TtsProvider {
  synthesize(text: AsyncIterable<string>, signal?: AbortSignal): AsyncIterable<Uint8Array>;
}
