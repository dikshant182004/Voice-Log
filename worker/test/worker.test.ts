import { describe, it, expect } from 'vitest';
import app from '../src/index';
import { calculatePercentiles } from '../src/db';
import { isValidUuid } from '../src/lib/ids';

/**
 * In-memory Mock D1 Database implementation to run tests without network dependencies.
 */
class MockD1Database {
  public calls = new Map<string, any>();
  public transcripts: any[] = [];
  public metrics: any[] = [];
  public evals = new Map<string, any>();

  prepare(query: string) {
    const self = this;
    return {
      _query: query,
      _bindings: [] as any[],
      bind(...args: any[]) {
        this._bindings = args;
        return this;
      },
      async first<T = any>(): Promise<T | null> {
        const q = this._query.toUpperCase();
        if (q.includes('FROM CALLS WHERE ID = ?')) {
          const call = self.calls.get(this._bindings[0]);
          return (call as T) || null;
        }
        if (q.includes('FROM CALL_EVALS WHERE CALL_ID = ?')) {
          const ev = self.evals.get(this._bindings[0]);
          return (ev as T) || null;
        }
        if (q.includes('SELECT') && q.includes('SUM(CASE WHEN STATUS')) {
          const all = Array.from(self.calls.values());
          return {
            total_calls: all.length,
            completed_calls: all.filter((c) => c.status === 'completed').length,
            error_calls: all.filter((c) => c.status === 'error').length,
            total_duration_ms: all.reduce((sum, c) => sum + (c.duration_ms || 0), 0),
            total_interruptions: all.reduce((sum, c) => sum + (c.interruption_count || 0), 0),
            total_turns: all.reduce((sum, c) => sum + (c.turn_count || 0), 0),
          } as T;
        }
        return null;
      },
      async all<T = any>(): Promise<{ results: T[] }> {
        const q = this._query.toUpperCase();
        if (q.includes('FROM TRANSCRIPTS WHERE CALL_ID = ?')) {
          const list = self.transcripts.filter((t) => t.call_id === this._bindings[0]);
          return { results: list as T[] };
        }
        if (q.includes('FROM CALL_METRICS WHERE CALL_ID = ?')) {
          const list = self.metrics.filter((m) => m.call_id === this._bindings[0]);
          return { results: list as T[] };
        }
        if (q.includes('FROM CALLS C') && q.includes('ORDER BY C.STARTED_AT DESC')) {
          const all = Array.from(self.calls.values()).sort((a, b) => b.started_at.localeCompare(a.started_at));
          const limit = this._bindings[this._bindings.length - 1] || 20;
          return { results: all.slice(0, limit) as T[] };
        }
        if (q.includes('FROM CALL_METRICS M')) {
          return { results: self.metrics as T[] };
        }
        if (q.includes('SUBSTR(STARTED_AT, 1, 10) AS DATE')) {
          return { results: [{ date: '2026-10-02', call_count: self.calls.size, avg_duration_ms: 120000 }] as T[] };
        }
        return { results: [] };
      },
      async run(): Promise<{ success: boolean; changes: number }> {
        const q = this._query.toUpperCase();
        if (q.includes('INSERT INTO CALL_EVALS')) {
          self.evals.set(this._bindings[0], {
            call_id: this._bindings[0],
            scores_json: this._bindings[1],
            summary: this._bindings[2],
            sentiment: this._bindings[3],
            flags_json: this._bindings[4],
            judge_model: this._bindings[5],
            created_at: this._bindings[6],
          });
          return { success: true, changes: 1 };
        }
        return { success: true, changes: 1 };
      },
    };
  }

  async batch(statements: any[]) {
    const results: any[] = [];
    for (const stmt of statements) {
      const q = stmt._query.toUpperCase();
      const b = stmt._bindings;
      let changes = 1;
      if (q.includes('INSERT INTO CALLS')) {
        if (!this.calls.has(b[0])) {
          this.calls.set(b[0], {
            id: b[0],
            started_at: b[1],
            ended_at: b[2],
            duration_ms: b[3],
            status: b[4],
            end_reason: b[5],
            config_json: b[6],
            turn_count: b[7],
            interruption_count: b[8],
            p50_v2v_ms: b[9],
            p95_v2v_ms: b[10],
            usage_json: b[11],
            created_at: b[12],
          });
          changes = 1;
        } else {
          changes = 0;
        }
      } else if (q.includes('INSERT INTO TRANSCRIPTS')) {
        const exists = this.transcripts.some((t) => t.call_id === b[0] && t.turn_index === b[1]);
        if (!exists) {
          this.transcripts.push({
            call_id: b[0],
            turn_index: b[1],
            role: b[2],
            text: b[3],
            ts_ms: b[4],
            interrupted: b[5],
          });
          changes = 1;
        } else {
          changes = 0;
        }
      } else if (q.includes('INSERT INTO CALL_METRICS')) {
        const exists = this.metrics.some((m) => m.call_id === b[0] && m.turn_index === b[1]);
        if (!exists) {
          this.metrics.push({
            call_id: b[0],
            turn_index: b[1],
            stt_ms: b[2],
            llm_ttfb_ms: b[3],
            tts_ttfb_ms: b[4],
            voice_to_voice_ms: b[5],
          });
          changes = 1;
        } else {
          changes = 0;
        }
      }
      results.push({ success: true, meta: { changes } });
    }
    return results;
  }
}

const TEST_ENV = {
  DB: new MockD1Database() as any,
  INGEST_TOKEN: 'secret_test_token_12345',
  ALLOWED_ORIGIN: 'http://localhost:3000',
};

const SAMPLE_CALL_PAYLOAD = {
  call_id: 'a1b2c3d4-e5f6-47a8-b9c0-112233445566',
  started_at: '2026-10-02T10:00:00.000Z',
  ended_at: '2026-10-02T10:02:10.500Z',
  duration_ms: 130500,
  status: 'completed',
  end_reason: 'user_hangup',
  config: {
    stt: 'deepgram:nova-3-general',
    llm: 'groq:openai/gpt-oss-20b',
    tts: 'cartesia:sonic-3.6',
    persona: 'default',
  },
  transcript: [
    { turn_index: 0, role: 'user', text: 'Hello, how can you help me today?', ts_ms: 1200, interrupted: false },
    { turn_index: 1, role: 'assistant', text: 'I can assist you with your call telemetry and metrics.', ts_ms: 2100, interrupted: false },
  ],
  metrics: [
    { turn_index: 1, stt_ms: 140, llm_ttfb_ms: 210, tts_ttfb_ms: 120, voice_to_voice_ms: 780 },
  ],
  usage: { llm_input_tokens: 45, llm_output_tokens: 32, tts_chars: 58 },
};

describe('Mini Call Log Service - Cloudflare Worker API', () => {
  it('GET /health returns 200 OK', async () => {
    const res = await app.request('/health', { method: 'GET' }, TEST_ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('ok');
    expect(body.service).toBe('mini-call-log-worker');
  });

  it('POST /calls rejects requests without Bearer token with 401', async () => {
    const res = await app.request(
      '/calls',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SAMPLE_CALL_PAYLOAD),
      },
      TEST_ENV
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /calls rejects invalid token with 401', async () => {
    const res = await app.request(
      '/calls',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer wrong_token',
        },
        body: JSON.stringify(SAMPLE_CALL_PAYLOAD),
      },
      TEST_ENV
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('INVALID_TOKEN');
  });

  it('POST /calls rejects malformed payload with 400 validation error', async () => {
    const invalidPayload = {
      ...SAMPLE_CALL_PAYLOAD,
      call_id: 'not-a-uuid', // invalid UUID
    };
    const res = await app.request(
      '/calls',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_ENV.INGEST_TOKEN}`,
        },
        body: JSON.stringify(invalidPayload),
      },
      TEST_ENV
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toBeDefined();
  });

  it('POST /calls creates a new call record with 201 Created', async () => {
    const res = await app.request(
      '/calls',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_ENV.INGEST_TOKEN}`,
        },
        body: JSON.stringify(SAMPLE_CALL_PAYLOAD),
      },
      TEST_ENV
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.id).toBe(SAMPLE_CALL_PAYLOAD.call_id);
  });

  it('POST /calls is idempotent on duplicate call_id (returns 200 duplicate: true)', async () => {
    const res = await app.request(
      '/calls',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_ENV.INGEST_TOKEN}`,
        },
        body: JSON.stringify(SAMPLE_CALL_PAYLOAD),
      },
      TEST_ENV
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe(SAMPLE_CALL_PAYLOAD.call_id);
    expect(body.duplicate).toBe(true);
  });

  it('GET /calls returns call list with cursor pagination', async () => {
    const res = await app.request('/calls?limit=10', { method: 'GET' }, TEST_ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0].id).toBe(SAMPLE_CALL_PAYLOAD.call_id);
  });

  it('GET /calls/:id returns call detail with transcripts and metrics', async () => {
    const res = await app.request(`/calls/${SAMPLE_CALL_PAYLOAD.call_id}`, { method: 'GET' }, TEST_ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.call.id).toBe(SAMPLE_CALL_PAYLOAD.call_id);
    expect(body.transcript.length).toBe(2);
    expect(body.metrics.length).toBe(1);
    expect(body.aggregate_metrics.voice_to_voice.p50_ms).toBe(780);
  });

  it('GET /calls/:id with invalid UUID returns 400', async () => {
    const res = await app.request('/calls/bad-id-123', { method: 'GET' }, TEST_ENV);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('INVALID_ID');
  });

  it('GET /calls/:id with unknown UUID returns 404', async () => {
    const res = await app.request('/calls/00000000-0000-4000-8000-000000000000', { method: 'GET' }, TEST_ENV);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CALL_NOT_FOUND');
  });

  it('GET /stats returns latency percentiles, call volume, and reliability metrics', async () => {
    const res = await app.request('/stats?days=7', { method: 'GET' }, TEST_ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.time_window_days).toBe(7);
    expect(body.total_calls).toBeGreaterThan(0);
    expect(body.latency_percentiles.voice_to_voice).toBeDefined();
    expect(res.headers.get('Cache-Control')).toContain('max-age=30');
  });

  it('OPTIONS request returns correct CORS headers', async () => {
    const res = await app.request(
      '/calls',
      {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:3000' },
      },
      TEST_ENV
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('POST /calls rejects oversized body with 413', async () => {
    const res = await app.request(
      '/calls',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_ENV.INGEST_TOKEN}`,
          'Content-Length': '600000', // > 512KB
        },
        body: JSON.stringify(SAMPLE_CALL_PAYLOAD),
      },
      TEST_ENV
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('CORS does not set allow header for disallowed external origin', async () => {
    const res = await app.request(
      '/calls',
      {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil-unauthorized-site.com' },
      },
      { ...TEST_ENV, ALLOW_DEV_ORIGINS: 'false' }
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('calculatePercentiles computes accurate p50 and p95 on known values', () => {
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const stats = calculatePercentiles(values);
    expect(stats.avg).toBe(550);
    expect(stats.p50).toBe(500);
    expect(stats.p95).toBe(1000);
    expect(stats.sample_size).toBe(10);

    const emptyStats = calculatePercentiles([]);
    expect(emptyStats.avg).toBeNull();
    expect(emptyStats.p50).toBeNull();
    expect(emptyStats.sample_size).toBe(0);
  });

  it('isValidUuid accurately validates UUID formats', () => {
    expect(isValidUuid('9b2c3d4e-5f6a-4b7c-8d9e-0123456789ab')).toBe(true);
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('')).toBe(false);
  });
});
