export type VoiceLogClientOptions = {
  baseUrl: string;
  apiKey: string;
};

export class VoiceLogClient {
  constructor(private readonly options: VoiceLogClientOptions) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(this.options.baseUrl.replace(/\/$/, '') + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.options.apiKey,
        ...(init.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || 'Voice-Log API request failed');
    return body as T;
  }

  createAgent(definition: unknown) {
    return this.request('/v1/agents', { method: 'POST', body: JSON.stringify(definition) });
  }

  getAgent(id: string, version?: number) {
    const query = version ? '?version=' + encodeURIComponent(String(version)) : '?published=true';
    return this.request('/v1/agents/' + encodeURIComponent(id) + query);
  }

  publishAgent(id: string, version: number) {
    return this.request('/v1/agents/' + encodeURIComponent(id) + '/versions/' + version + '/publish', { method: 'POST' });
  }

  respond(input: {
    agent_id: string;
    agent_version?: number;
    user_id?: string;
    session_id?: string;
    message: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) {
    return this.request('/v1/runtime/respond', { method: 'POST', body: JSON.stringify(input) });
  }

  listCalls(limit = 20, cursor?: string) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return this.request('/v1/calls?' + query.toString());
  }

  getStats(days = 7) {
    return this.request('/v1/stats?days=' + encodeURIComponent(String(days)));
  }
}
