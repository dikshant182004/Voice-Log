import type { D1Database } from '@cloudflare/workers-types';
export type { D1Database };

import {
  PostCallPayload,
  CallsListResponse,
  CallDetailResponse,
  CallStatsResponse,
  CallEval,
} from './schemas';

/**
 * Calculates average and nearest-rank p50 and p95 from a sorted array of numbers.
 */
export function calculatePercentiles(sortedValues: number[]): { avg: number | null; p50: number | null; p95: number | null; sample_size: number } {
  if (!sortedValues || sortedValues.length === 0) {
    return { avg: null, p50: null, p95: null, sample_size: 0 };
  }
  const sum = sortedValues.reduce((acc, val) => acc + val, 0);
  const avg = Math.round((sum / sortedValues.length) * 10) / 10;

  // Nearest-rank method (N-1 index for 0-indexed arrays)
  const n = sortedValues.length;
  const p50Idx = Math.max(0, Math.min(n - 1, Math.ceil(0.50 * n) - 1));
  const p95Idx = Math.max(0, Math.min(n - 1, Math.ceil(0.95 * n) - 1));

  return {
    avg,
    p50: sortedValues[p50Idx],
    p95: sortedValues[p95Idx],
    sample_size: n,
  };
}

function encodeCursor(startedAt: string, id: string): string {
  return btoa(JSON.stringify({ s: startedAt, id }));
}

function decodeCursor(cursor: string): { startedAt: string; id: string } | null {
  try {
    const raw = atob(cursor);
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.s === 'string' && typeof parsed.id === 'string') {
      return { startedAt: parsed.s, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

export interface CallRepository {
  insertCall(db: D1Database, payload: PostCallPayload): Promise<{ duplicate: boolean; callId: string }>;
  listCalls(db: D1Database, tenantId: string, limit: number, cursor?: string): Promise<CallsListResponse>;
  getCallById(db: D1Database, tenantId: string, callId: string): Promise<CallDetailResponse | null>;
  getStats(db: D1Database, tenantId: string, days: number): Promise<CallStatsResponse>;
  insertEval(db: D1Database, evaluation: CallEval): Promise<void>;
}

export const callRepo: CallRepository = {
  async insertCall(db: D1Database, payload: PostCallPayload) {
    const callId = payload.call_id;
    const createdAt = new Date().toISOString();

    const turnCount = payload.transcript.length;
    const interruptionCount = payload.transcript.filter((t) => t.interrupted).length;

    const v2vValues = payload.metrics
      .map((m) => m.voice_to_voice_ms)
      .filter((v): v is number => typeof v === 'number' && v > 0)
      .sort((a, b) => a - b);
    const { p50: p50V2v, p95: p95V2v } = calculatePercentiles(v2vValues);

    const configJson = JSON.stringify(payload.config);
    const usageJson = JSON.stringify(payload.usage);

    // Build the atomic batch statements
    const batchStatements: any[] = [];

    // 1. Insert Call row with ON CONFLICT DO NOTHING
    batchStatements.push(
      db
        .prepare(
          `INSERT INTO calls (
            id, tenant_id, agent_id, agent_version, user_id, started_at, ended_at, duration_ms, status, end_reason,
            config_json, turn_count, interruption_count, p50_v2v_ms, p95_v2v_ms,
            usage_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING`
        )
        .bind(
          callId,
          payload.tenant_id,
          payload.agent_id ?? null,
          payload.agent_version ?? null,
          payload.user_id ?? null,
          payload.started_at,
          payload.ended_at,
          payload.duration_ms,
          payload.status,
          payload.end_reason ?? null,
          configJson,
          turnCount,
          interruptionCount,
          p50V2v,
          p95V2v,
          usageJson,
          createdAt
        )
    );

    // 2. Insert Transcript turns
    for (const t of payload.transcript) {
      batchStatements.push(
        db
          .prepare(
            `INSERT INTO transcripts (call_id, turn_index, role, text, ts_ms, interrupted)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(call_id, turn_index) DO NOTHING`
          )
          .bind(callId, t.turn_index, t.role, t.text, t.ts_ms ?? 0, t.interrupted ? 1 : 0)
      );
    }

    // 3. Insert Metrics
    for (const m of payload.metrics) {
      batchStatements.push(
        db
          .prepare(
            `INSERT INTO call_metrics (call_id, turn_index, stt_ms, llm_ttfb_ms, tts_ttfb_ms, voice_to_voice_ms)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(call_id, turn_index) DO NOTHING`
          )
          .bind(
            callId,
            m.turn_index,
            m.stt_ms ?? null,
            m.llm_ttfb_ms ?? null,
            m.tts_ttfb_ms ?? null,
            m.voice_to_voice_ms ?? null
          )
      );
    }

    // Execute everything in a single atomic D1 transaction
    const batchResults = await db.batch(batchStatements);

    // Check meta.changes on the first statement (calls table insert)
    const callInsertMeta = (batchResults[0] as any)?.meta;
    const isDuplicate = callInsertMeta?.changes === 0;

    return { duplicate: isDuplicate, callId };
  },

  async listCalls(db: D1Database, tenantId: string, limit: number, cursor?: string): Promise<CallsListResponse> {
    const clampedLimit = Math.max(1, Math.min(limit, 100));
    const decodedCursor = cursor ? decodeCursor(cursor) : null;

    let query: string;
    let bindings: any[];

    if (decodedCursor) {
      query = `
        SELECT c.id, c.started_at, c.duration_ms, c.status, c.end_reason,
               c.turn_count, c.interruption_count, c.p50_v2v_ms,
               e.summary AS summary
        FROM calls c
        LEFT JOIN call_evals e ON c.id = e.call_id
        WHERE c.tenant_id = ? AND ((c.started_at < ?) OR (c.started_at = ? AND c.id < ?))
        ORDER BY c.started_at DESC, c.id DESC
        LIMIT ?
      `;
      bindings = [tenantId, decodedCursor.startedAt, decodedCursor.startedAt, decodedCursor.id, clampedLimit + 1];
    } else {
      query = `
        SELECT c.id, c.started_at, c.duration_ms, c.status, c.end_reason,
               c.turn_count, c.interruption_count, c.p50_v2v_ms,
               e.summary AS summary
        FROM calls c
        LEFT JOIN call_evals e ON c.id = e.call_id
        WHERE c.tenant_id = ?
        ORDER BY c.started_at DESC, c.id DESC
        LIMIT ?
      `;
      bindings = [tenantId, clampedLimit + 1];
    }

    const { results } = await db.prepare(query).bind(...bindings).all<any>();
    const hasMore = results.length > clampedLimit;
    const items = hasMore ? results.slice(0, clampedLimit) : results;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor(last.started_at, last.id);
    }

    return {
      items: items.map((r: any) => ({
        id: r.id,
        started_at: r.started_at,
        duration_ms: Number(r.duration_ms),
        status: r.status,
        end_reason: r.end_reason,
        turn_count: Number(r.turn_count),
        interruption_count: Number(r.interruption_count ?? 0),
        p50_voice_to_voice_ms: r.p50_v2v_ms !== null ? Number(r.p50_v2v_ms) : null,
        summary: r.summary ?? null,
      })),
      next_cursor: nextCursor,
    };
  },

  async getCallById(db: D1Database, tenantId: string, callId: string): Promise<CallDetailResponse | null> {
    // Explicit columns instead of SELECT *
    const callRow = await db
      .prepare(
        `SELECT id, started_at, ended_at, duration_ms, status, end_reason,
                config_json, turn_count, interruption_count, p50_v2v_ms, p95_v2v_ms,
                usage_json, created_at
         FROM calls WHERE id = ? AND tenant_id = ? LIMIT 1`
      )
      .bind(callId, tenantId)
      .first<any>();

    if (!callRow) {
      return null;
    }

    // Query transcripts, metrics, and evals in parallel with explicit columns
    const [transcriptRes, metricsRes, evalRes] = await Promise.all([
      db
        .prepare('SELECT turn_index, role, text, ts_ms, interrupted FROM transcripts WHERE call_id = ? ORDER BY turn_index ASC')
        .bind(callId)
        .all<any>(),
      db
        .prepare('SELECT turn_index, stt_ms, llm_ttfb_ms, tts_ttfb_ms, voice_to_voice_ms FROM call_metrics WHERE call_id = ? ORDER BY turn_index ASC')
        .bind(callId)
        .all<any>(),
      db
        .prepare('SELECT call_id, scores_json, summary, sentiment, flags_json, judge_model, created_at FROM call_evals WHERE call_id = ? LIMIT 1')
        .bind(callId)
        .first<any>(),
    ]);

    const transcript = (transcriptRes.results || []).map((t: any) => ({
      turn_index: Number(t.turn_index),
      role: t.role as 'user' | 'assistant' | 'system',
      text: t.text,
      ts_ms: Number(t.ts_ms || 0),
      interrupted: Boolean(t.interrupted),
    }));

    const metrics = (metricsRes.results || []).map((m: any) => ({
      turn_index: Number(m.turn_index),
      stt_ms: m.stt_ms !== null ? Number(m.stt_ms) : null,
      llm_ttfb_ms: m.llm_ttfb_ms !== null ? Number(m.llm_ttfb_ms) : null,
      tts_ttfb_ms: m.tts_ttfb_ms !== null ? Number(m.tts_ttfb_ms) : null,
      voice_to_voice_ms: m.voice_to_voice_ms !== null ? Number(m.voice_to_voice_ms) : null,
    }));

    const v2vList = metrics.map((m: any) => m.voice_to_voice_ms).filter((v: any): v is number => typeof v === 'number').sort((a, b) => a - b);
    const sttList = metrics.map((m: any) => m.stt_ms).filter((v: any): v is number => typeof v === 'number').sort((a, b) => a - b);
    const llmList = metrics.map((m: any) => m.llm_ttfb_ms).filter((v: any): v is number => typeof v === 'number').sort((a, b) => a - b);
    const ttsList = metrics.map((m: any) => m.tts_ttfb_ms).filter((v: any): v is number => typeof v === 'number').sort((a, b) => a - b);

    const v2vStats = calculatePercentiles(v2vList);
    const sttStats = calculatePercentiles(sttList);
    const llmStats = calculatePercentiles(llmList);
    const ttsStats = calculatePercentiles(ttsList);

    let parsedConfig = { stt: 'deepgram:nova-3-general', llm: 'groq:openai/gpt-oss-20b', tts: 'cartesia:sonic-3.6', persona: 'default' };
    try {
      if (callRow.config_json) parsedConfig = JSON.parse(callRow.config_json);
    } catch {}

    let parsedUsage = { llm_input_tokens: 0, llm_output_tokens: 0, tts_chars: 0 };
    try {
      if (callRow.usage_json) parsedUsage = JSON.parse(callRow.usage_json);
    } catch {}

    let parsedEval: CallEval | null = null;
    if (evalRes) {
      let scores = { task_completion: 4, tone: 4, relevance: 4, hallucination_risk: 1 };
      try {
        if (evalRes.scores_json) scores = JSON.parse(evalRes.scores_json);
      } catch {}

      let flags: string[] = [];
      try {
        if (evalRes.flags_json) flags = JSON.parse(evalRes.flags_json);
      } catch {}

      parsedEval = {
        call_id: evalRes.call_id,
        summary: evalRes.summary || '',
        sentiment: evalRes.sentiment || 'neutral',
        scores,
        flags,
        judge_model: evalRes.judge_model || 'groq',
        created_at: evalRes.created_at,
      };
    }

    return {
      call: {
        id: callRow.id,
        started_at: callRow.started_at,
        ended_at: callRow.ended_at,
        duration_ms: Number(callRow.duration_ms),
        status: callRow.status,
        end_reason: callRow.end_reason,
        config: parsedConfig,
        turn_count: Number(callRow.turn_count),
        interruption_count: Number(callRow.interruption_count),
        p50_v2v_ms: callRow.p50_v2v_ms !== null ? Number(callRow.p50_v2v_ms) : null,
        p95_v2v_ms: callRow.p95_v2v_ms !== null ? Number(callRow.p95_v2v_ms) : null,
        usage: parsedUsage,
        created_at: callRow.created_at,
      },
      transcript,
      metrics,
      aggregate_metrics: {
        voice_to_voice: { avg_ms: v2vStats.avg, p50_ms: v2vStats.p50, p95_ms: v2vStats.p95, sample_size: v2vStats.sample_size },
        stt: { avg_ms: sttStats.avg, p50_ms: sttStats.p50, p95_ms: sttStats.p95, sample_size: sttStats.sample_size },
        llm_ttfb: { avg_ms: llmStats.avg, p50_ms: llmStats.p50, p95_ms: llmStats.p95, sample_size: llmStats.sample_size },
        tts_ttfb: { avg_ms: ttsStats.avg, p50_ms: ttsStats.p50, p95_ms: ttsStats.p95, sample_size: ttsStats.sample_size },
      },
      eval: parsedEval,
    };
  },

  async getStats(db: D1Database, tenantId: string, days: number): Promise<CallStatsResponse> {
    const windowDays = Math.max(1, Math.min(days, 90));
    const sinceDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const summaryQuery = `
      SELECT
        COUNT(*) as total_calls,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_calls,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_calls,
        SUM(duration_ms) as total_duration_ms,
        SUM(interruption_count) as total_interruptions,
        SUM(turn_count) as total_turns
      FROM calls
      WHERE tenant_id = ? AND started_at >= ?
    `;
    const summaryRow = await db.prepare(summaryQuery).bind(tenantId, sinceDate).first<any>();

    const totalCalls = Number(summaryRow?.total_calls || 0);
    const completedCalls = Number(summaryRow?.completed_calls || 0);
    const errorCalls = Number(summaryRow?.error_calls || 0);
    const totalDuration = Number(summaryRow?.total_duration_ms || 0);
    const totalInterruptions = Number(summaryRow?.total_interruptions || 0);
    const totalTurns = Number(summaryRow?.total_turns || 0);

    const errorRatePct = totalCalls > 0 ? Math.round((errorCalls / totalCalls) * 1000) / 10 : 0;
    const interruptionRatePct = totalTurns > 0 ? Math.round((totalInterruptions / totalTurns) * 1000) / 10 : 0;
    const avgDurationMs = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;

    const dailyVolumeQuery = `
      SELECT
        SUBSTR(started_at, 1, 10) as date,
        COUNT(*) as call_count,
        AVG(duration_ms) as avg_duration_ms
      FROM calls
      WHERE tenant_id = ? AND started_at >= ?
      GROUP BY SUBSTR(started_at, 1, 10)
      ORDER BY date ASC
    `;
    const dailyRows = await db.prepare(dailyVolumeQuery).bind(tenantId, sinceDate).all<any>();
    const dailyVolume = (dailyRows.results || []).map((r: any) => ({
      date: r.date,
      call_count: Number(r.call_count),
      avg_duration_ms: Math.round(Number(r.avg_duration_ms)),
    }));

    // Bounded ordered slices for percentile calculations (up to 1000 rows each)
    const [v2vRows, sttRows, llmRows, ttsRows] = await Promise.all([
      db
        .prepare(`SELECT m.voice_to_voice_ms FROM call_metrics m JOIN calls c ON m.call_id = c.id WHERE c.tenant_id = ? AND c.started_at >= ? AND m.voice_to_voice_ms IS NOT NULL ORDER BY m.voice_to_voice_ms ASC LIMIT 1000`)
        .bind(tenantId, sinceDate)
        .all<any>(),
      db
        .prepare(`SELECT m.stt_ms FROM call_metrics m JOIN calls c ON m.call_id = c.id WHERE c.tenant_id = ? AND c.started_at >= ? AND m.stt_ms IS NOT NULL ORDER BY m.stt_ms ASC LIMIT 1000`)
        .bind(sinceDate)
        .all<any>(),
      db
        .prepare(`SELECT m.llm_ttfb_ms FROM call_metrics m JOIN calls c ON m.call_id = c.id WHERE c.tenant_id = ? AND c.started_at >= ? AND m.llm_ttfb_ms IS NOT NULL ORDER BY m.llm_ttfb_ms ASC LIMIT 1000`)
        .bind(sinceDate)
        .all<any>(),
      db
        .prepare(`SELECT m.tts_ttfb_ms FROM call_metrics m JOIN calls c ON m.call_id = c.id WHERE c.tenant_id = ? AND c.started_at >= ? AND m.tts_ttfb_ms IS NOT NULL ORDER BY m.tts_ttfb_ms ASC LIMIT 1000`)
        .bind(sinceDate)
        .all<any>(),
    ]);

    const v2vList = (v2vRows.results || []).map((r: any) => Number(r.voice_to_voice_ms));
    const sttList = (sttRows.results || []).map((r: any) => Number(r.stt_ms));
    const llmList = (llmRows.results || []).map((r: any) => Number(r.llm_ttfb_ms));
    const ttsList = (ttsRows.results || []).map((r: any) => Number(r.tts_ttfb_ms));

    const v2vStats = calculatePercentiles(v2vList);
    const sttStats = calculatePercentiles(sttList);
    const llmStats = calculatePercentiles(llmList);
    const ttsStats = calculatePercentiles(ttsList);

    return {
      time_window_days: windowDays,
      total_calls: totalCalls,
      completed_calls: completedCalls,
      error_rate_pct: errorRatePct,
      interruption_rate_pct: interruptionRatePct,
      avg_duration_ms: avgDurationMs,
      latency_percentiles: {
        voice_to_voice: { avg_ms: v2vStats.avg, p50_ms: v2vStats.p50, p95_ms: v2vStats.p95, sample_size: v2vStats.sample_size },
        stt: { avg_ms: sttStats.avg, p50_ms: sttStats.p50, p95_ms: sttStats.p95, sample_size: sttStats.sample_size },
        llm_ttfb: { avg_ms: llmStats.avg, p50_ms: llmStats.p50, p95_ms: llmStats.p95, sample_size: llmStats.sample_size },
        tts_ttfb: { avg_ms: ttsStats.avg, p50_ms: ttsStats.p50, p95_ms: ttsStats.p95, sample_size: ttsStats.sample_size },
      },
      daily_volume: dailyVolume,
    };
  },

  async insertEval(db: D1Database, evaluation: CallEval) {
    const scoresJson = JSON.stringify(evaluation.scores);
    const flagsJson = JSON.stringify(evaluation.flags || []);

    await db
      .prepare(
        `INSERT INTO call_evals (call_id, scores_json, summary, sentiment, flags_json, judge_model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(call_id) DO UPDATE SET
           scores_json = excluded.scores_json,
           summary = excluded.summary,
           sentiment = excluded.sentiment,
           flags_json = excluded.flags_json,
           judge_model = excluded.judge_model,
           created_at = excluded.created_at`
      )
      .bind(
        evaluation.call_id,
        scoresJson,
        evaluation.summary,
        evaluation.sentiment,
        flagsJson,
        evaluation.judge_model,
        evaluation.created_at
      )
      .run();
  },
};
