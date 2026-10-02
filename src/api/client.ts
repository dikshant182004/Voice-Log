import {
  CallsListResponse,
  CallDetailResponse,
  CallStatsResponse,
} from '../types';

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function getBaseUrl(): string {
  const url = import.meta.env.VITE_API_BASE_URL;
  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new ConfigurationError(
      'VITE_API_BASE_URL is not configured. Please set the Cloudflare Worker API URL in your environment.'
    );
  }
  return url.replace(/\/+$/, '');
}

async function requestJson<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = 8000
): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Link caller signal if passed
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...(options.headers || {}),
      },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        // Not a JSON error body
      }

      const code = errBody?.error?.code || `HTTP_${res.status}`;
      const message = errBody?.error?.message || `Request failed with status ${res.status}`;
      const requestId = errBody?.error?.request_id || res.headers.get('X-Request-ID') || undefined;
      const details = errBody?.error?.details;

      throw new HttpError(res.status, code, message, requestId, details);
    }

    return (await res.json()) as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err instanceof ConfigurationError || err instanceof HttpError) {
      throw err;
    }
    if (err.name === 'AbortError') {
      throw new NetworkError(`Request to ${endpoint} timed out after ${timeoutMs}ms or was aborted`, err);
    }
    throw new NetworkError(`Network connection to ${url} failed: ${err.message}`, err);
  }
}

export const apiClient = {
  isConfigured(): boolean {
    const url = import.meta.env.VITE_API_BASE_URL;
    return Boolean(url && typeof url === 'string' && url.trim().length > 0);
  },

  getBaseUrlSafe(): string {
    return (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  },

  async listCalls(limit = 20, cursor?: string | null, signal?: AbortSignal): Promise<CallsListResponse> {
    const params = new URLSearchParams();
    params.set('limit', String(Math.max(1, Math.min(limit, 100))));
    if (cursor) {
      params.set('cursor', cursor);
    }
    return requestJson<CallsListResponse>(`/calls?${params.toString()}`, { method: 'GET', signal });
  },

  async getCall(id: string, signal?: AbortSignal): Promise<CallDetailResponse> {
    if (!id || typeof id !== 'string') {
      throw new Error('Call ID must be provided');
    }
    return requestJson<CallDetailResponse>(`/calls/${encodeURIComponent(id)}`, { method: 'GET', signal });
  },

  async getStats(days = 7, signal?: AbortSignal): Promise<CallStatsResponse> {
    const safeDays = Math.max(1, Math.min(days, 90));
    return requestJson<CallStatsResponse>(`/stats?days=${safeDays}`, { method: 'GET', signal });
  },
};
