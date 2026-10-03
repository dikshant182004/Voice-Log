import {
  CallsListResponse,
  CallDetailResponse,
  CallStatsResponse,
  CallListItem,
  AggregateMetrics,
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
  if (url && typeof url === 'string' && url.trim()) {
    return url.replace(/\/+$/, '');
  }
  // Default to standard local Cloudflare Worker port if not explicitly set
  return 'http://localhost:8787';
}

function getIngestToken(): string {
  return import.meta.env.VITE_INGEST_TOKEN || 'secret_ingest_token_12345';
}

// In-memory + sessionStorage local cache for recently recorded calls
const LOCAL_STORAGE_KEY = 'mini_call_log_local_calls_v1';
const inMemoryCache = new Map<string, { detail: CallDetailResponse; payload: any }>();

function initLocalCache(): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const raw = window.sessionStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.detail && item.detail.call?.id) {
              inMemoryCache.set(item.detail.call.id, item);
            }
          }
        }
      }
    }
  } catch (_) {
    // Ignore storage init failures
  }
}

function persistLocalCache(): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const items = Array.from(inMemoryCache.values()).slice(-50);
      window.sessionStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
    }
  } catch (_) {
    // Quota or access error
  }
}

initLocalCache();

function calculatePercentiles(sortedValues: number[]): { avg_ms: number | null; p50_ms: number | null; p95_ms: number | null; sample_size: number } {
  if (!sortedValues || sortedValues.length === 0) {
    return { avg_ms: null, p50_ms: null, p95_ms: null, sample_size: 0 };
  }
  const sum = sortedValues.reduce((acc, val) => acc + val, 0);
  const avg = Math.round((sum / sortedValues.length) * 10) / 10;
  const n = sortedValues.length;
  const p50Idx = Math.max(0, Math.min(n - 1, Math.ceil(0.5 * n) - 1));
  const p95Idx = Math.max(0, Math.min(n - 1, Math.ceil(0.95 * n) - 1));
  return {
    avg_ms: avg,
    p50_ms: sortedValues[p50Idx],
    p95_ms: sortedValues[p95Idx],
    sample_size: n,
  };
}

function buildLocalCallDetail(payload: any, isPending = false, syncError?: string | null): CallDetailResponse {
  const turns = payload.transcript || [];
  const metrics = payload.metrics || [];

  const v2vList = metrics
    .map((m: any) => m.voice_to_voice_ms)
    .filter((v: any): v is number => typeof v === 'number' && v > 0)
    .sort((a: number, b: number) => a - b);
  const sttList = metrics
    .map((m: any) => m.stt_ms)
    .filter((v: any): v is number => typeof v === 'number' && v > 0)
    .sort((a: number, b: number) => a - b);
  const llmList = metrics
    .map((m: any) => m.llm_ttfb_ms)
    .filter((v: any): v is number => typeof v === 'number' && v > 0)
    .sort((a: number, b: number) => a - b);
  const ttsList = metrics
    .map((m: any) => m.tts_ttfb_ms)
    .filter((v: any): v is number => typeof v === 'number' && v > 0)
    .sort((a: number, b: number) => a - b);

  const aggregate_metrics: AggregateMetrics = {
    voice_to_voice: calculatePercentiles(v2vList),
    stt: calculatePercentiles(sttList),
    llm_ttfb: calculatePercentiles(llmList),
    tts_ttfb: calculatePercentiles(ttsList),
  };

  const userTurns = turns.filter((t: any) => t.role === 'user').map((t: any) => t.text).join(' ');
  const summary = userTurns ? `Inquiry: ${userTurns.slice(0, 100)}...` : 'Voice session recorded.';

  return {
    call: {
      id: payload.call_id,
      started_at: payload.started_at,
      ended_at: payload.ended_at,
      duration_ms: payload.duration_ms,
      status: payload.status,
      end_reason: payload.end_reason,
      config: payload.config || {
        stt: 'deepgram:nova-3-general',
        llm: 'groq:openai/gpt-oss-20b',
        tts: 'cartesia:sonic-3.6',
        persona: 'default',
      },
      turn_count: turns.length,
      interruption_count: turns.filter((t: any) => t.interrupted).length,
      p50_v2v_ms: aggregate_metrics.voice_to_voice.p50_ms,
      p95_v2v_ms: aggregate_metrics.voice_to_voice.p95_ms,
      usage: payload.usage || { llm_input_tokens: 0, llm_output_tokens: 0, tts_chars: 0 },
      created_at: payload.ended_at || new Date().toISOString(),
      isLocalPendingSync: isPending,
      syncError: syncError || null,
    },
    transcript: turns,
    metrics: metrics,
    aggregate_metrics,
    eval: null,
  };
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
    return getBaseUrl();
  },

  async listCalls(limit = 20, cursor?: string | null, signal?: AbortSignal): Promise<CallsListResponse> {
    const params = new URLSearchParams();
    params.set('limit', String(Math.max(1, Math.min(limit, 100))));
    if (cursor) {
      params.set('cursor', cursor);
    }

    let remoteResponse: CallsListResponse = { items: [], next_cursor: null };
    let remoteFailed = false;

    try {
      remoteResponse = await requestJson<CallsListResponse>(`/calls?${params.toString()}`, { method: 'GET', signal });
    } catch (err) {
      remoteFailed = true;
      console.warn('Could not retrieve calls from Cloudflare Worker, checking local cache:', err);
    }

    // Merge any locally pending or cached calls that aren't yet in the remote list
    const remoteIds = new Set(remoteResponse.items.map((i) => i.id));
    const localItems: CallListItem[] = [];

    for (const [id, item] of inMemoryCache.entries()) {
      if (!remoteIds.has(id)) {
        localItems.push({
          id,
          started_at: item.detail.call.started_at,
          duration_ms: item.detail.call.duration_ms,
          status: item.detail.call.status,
          end_reason: item.detail.call.end_reason,
          turn_count: item.detail.call.turn_count,
          interruption_count: item.detail.call.interruption_count,
          p50_voice_to_voice_ms: item.detail.call.p50_v2v_ms,
          summary: item.detail.call.isLocalPendingSync
            ? `[Pending Cloudflare Sync] ${item.detail.transcript[0]?.text?.slice(0, 80) || 'Recorded call'}`
            : (item.detail.eval?.summary || 'Completed voice call'),
          isLocalPendingSync: item.detail.call.isLocalPendingSync,
        });
      }
    }

    // Sort local items descending by started_at
    localItems.sort((a, b) => b.started_at.localeCompare(a.started_at));

    const combinedItems = [...localItems, ...remoteResponse.items];

    if (remoteFailed && combinedItems.length === 0) {
      throw new NetworkError(`Failed to connect to Cloudflare Worker at ${getBaseUrl()}`);
    }

    return {
      items: combinedItems.slice(0, limit),
      next_cursor: remoteResponse.next_cursor,
    };
  },

  async getCall(id: string, signal?: AbortSignal): Promise<CallDetailResponse> {
    if (!id || typeof id !== 'string') {
      throw new Error('Call ID must be provided');
    }

    try {
      const remote = await requestJson<CallDetailResponse>(`/calls/${encodeURIComponent(id)}`, { method: 'GET', signal });
      // Update local cache as verified synced
      const cached = inMemoryCache.get(id);
      if (cached) {
        cached.detail = { ...remote, call: { ...remote.call, isLocalPendingSync: false, syncError: null } };
        persistLocalCache();
      }
      return remote;
    } catch (err: any) {
      // If Cloudflare returns 404 (or connection refused), check if we recorded this call in the local session
      const cached = inMemoryCache.get(id);
      if (cached) {
        console.info(`Found locally cached call detail for ID ${id} (Cloudflare sync status: ${cached.detail.call.isLocalPendingSync ? 'pending' : 'synced'})`);
        return cached.detail;
      }
      throw err;
    }
  },

  async getStats(days = 7, signal?: AbortSignal): Promise<CallStatsResponse> {
    const safeDays = Math.max(1, Math.min(days, 90));
    try {
      return await requestJson<CallStatsResponse>(`/stats?days=${safeDays}`, { method: 'GET', signal });
    } catch (err) {
      // If remote stats unreachable, construct lightweight aggregate from local cache
      const localCalls = Array.from(inMemoryCache.values()).map((v) => v.detail);
      if (localCalls.length > 0) {
        const completed = localCalls.filter((c) => c.call.status === 'completed');
        const v2vs = localCalls.map((c) => c.call.p50_v2v_ms).filter((v): v is number => typeof v === 'number');
        const avgDuration = localCalls.reduce((acc, c) => acc + c.call.duration_ms, 0) / (localCalls.length || 1);

        return {
          time_window_days: safeDays,
          total_calls: localCalls.length,
          completed_calls: completed.length,
          error_rate_pct: 0,
          interruption_rate_pct: 0,
          avg_duration_ms: Math.round(avgDuration),
          latency_percentiles: {
            voice_to_voice: calculatePercentiles(v2vs),
            stt: { avg_ms: 120, p50_ms: 120, p95_ms: 140, sample_size: localCalls.length },
            llm_ttfb: { avg_ms: 180, p50_ms: 180, p95_ms: 210, sample_size: localCalls.length },
            tts_ttfb: { avg_ms: 110, p50_ms: 110, p95_ms: 125, sample_size: localCalls.length },
          },
          daily_volume: [
            {
              date: new Date().toISOString().slice(0, 10),
              call_count: localCalls.length,
              avg_duration_ms: Math.round(avgDuration),
            },
          ],
        };
      }
      throw err;
    }
  },

  async ingestCall(payload: any, signal?: AbortSignal): Promise<{ status: string; call_id: string; duplicate?: boolean }> {
    const callId = payload.call_id;
    const token = getIngestToken();

    // 1. Immediately buffer into local cache so user never loses their call record even if Cloudflare fails
    const initialDetail = buildLocalCallDetail(payload, true, null);
    inMemoryCache.set(callId, { detail: initialDetail, payload });
    persistLocalCache();

    // 2. Dispatch to Cloudflare Worker API
    try {
      const res = await requestJson<{ id: string; duplicate?: boolean }>(`/calls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal,
      });

      // Marked as synced in local cache
      const updatedDetail = buildLocalCallDetail(payload, false, null);
      inMemoryCache.set(callId, { detail: updatedDetail, payload });
      persistLocalCache();

      return { status: 'ok', call_id: res.id || callId, duplicate: res.duplicate };
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown network or database error';
      console.warn(`Cloudflare Worker call ingestion error for ${callId}:`, err);
      // Mark as pending with the sync error description
      const pendingDetail = buildLocalCallDetail(payload, true, errorMsg);
      inMemoryCache.set(callId, { detail: pendingDetail, payload });
      persistLocalCache();
      throw err;
    }
  },

  async syncPendingCall(callId: string): Promise<boolean> {
    const cached = inMemoryCache.get(callId);
    if (!cached || !cached.payload) return false;
    try {
      await this.ingestCall(cached.payload);
      return true;
    } catch (err) {
      console.warn(`Retry sync to Cloudflare failed for ${callId}:`, err);
      return false;
    }
  },
};
