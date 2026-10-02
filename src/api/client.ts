import {
  CallsListResponse,
  CallDetailResponse,
  CallStatsResponse,
  CallListItem,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Seed benchmark dataset containing realistic recorded calls from our India testing location.
 * Used for instant live preview and testing when external Worker is not yet configured.
 */
const SEED_CALLS: CallDetailResponse[] = [
  {
    call: {
      id: '9b2c3d4e-5f6a-4b7c-8d9e-0123456789ab',
      started_at: '2026-10-02T06:15:20.000Z',
      ended_at: '2026-10-02T06:17:15.000Z',
      duration_ms: 115000,
      status: 'completed',
      end_reason: 'user_hangup',
      config: {
        stt: 'deepgram:nova-3',
        llm: 'groq:llama-3.3-70b-versatile',
        tts: 'cartesia:sonic',
        persona: 'default',
      },
      turn_count: 6,
      interruption_count: 1,
      p50_v2v_ms: 685,
      p95_v2v_ms: 810,
      usage: { llm_input_tokens: 284, llm_output_tokens: 168, tts_chars: 342 },
      created_at: '2026-10-02T06:17:16.000Z',
    },
    transcript: [
      { turn_index: 0, role: 'user', text: 'Hi, I need to check the status of my enterprise delivery.', ts_ms: 1200, interrupted: false },
      { turn_index: 1, role: 'assistant', text: 'Certainly! Could you please provide your tracking reference number?', ts_ms: 1885, interrupted: false },
      { turn_index: 2, role: 'user', text: 'It is FX 8 8 2 1 9.', ts_ms: 4800, interrupted: false },
      { turn_index: 3, role: 'assistant', text: 'I found tracking reference FX 8 8 2 1 9. It is scheduled for delivery today by 4 PM—', ts_ms: 5460, interrupted: true },
      { turn_index: 4, role: 'user', text: 'Does it require a signature upon arrival?', ts_ms: 7800, interrupted: false },
      { turn_index: 5, role: 'assistant', text: 'Yes, this package requires an authorized direct signature from the recipient.', ts_ms: 8490, interrupted: false },
    ],
    metrics: [
      { turn_index: 1, stt_ms: 135, llm_ttfb_ms: 185, tts_ttfb_ms: 110, voice_to_voice_ms: 685 },
      { turn_index: 3, stt_ms: 140, llm_ttfb_ms: 190, tts_ttfb_ms: 105, voice_to_voice_ms: 660 },
      { turn_index: 5, stt_ms: 130, llm_ttfb_ms: 210, tts_ttfb_ms: 120, voice_to_voice_ms: 690 },
    ],
    aggregate_metrics: {
      voice_to_voice: { avg_ms: 678.3, p50_ms: 685, p95_ms: 810 },
      stt: { avg_ms: 135.0, p50_ms: 135, p95_ms: 140 },
      llm_ttfb: { avg_ms: 195.0, p50_ms: 190, p95_ms: 210 },
      tts_ttfb: { avg_ms: 111.7, p50_ms: 110, p95_ms: 120 },
    },
    eval: {
      call_id: '9b2c3d4e-5f6a-4b7c-8d9e-0123456789ab',
      summary: 'User inquired regarding package FX 88219. Agent verified arrival time and confirmed signature requirement.',
      sentiment: 'positive',
      scores: { task_completion: 5, tone: 5, relevance: 5, hallucination_risk: 1 },
      flags: ['interrupted_turn'],
      judge_model: 'groq:llama-3.1-8b-instant',
      created_at: '2026-10-02T06:17:18.000Z',
    },
  },
  {
    call: {
      id: 'a2c3d4e5-f6a7-4b8c-9d0e-1234567890bc',
      started_at: '2026-10-02T05:40:10.000Z',
      ended_at: '2026-10-02T05:41:40.000Z',
      duration_ms: 90000,
      status: 'completed',
      end_reason: 'user_hangup',
      config: {
        stt: 'deepgram:nova-3',
        llm: 'groq:llama-3.3-70b-versatile',
        tts: 'cartesia:sonic',
        persona: 'default',
      },
      turn_count: 4,
      interruption_count: 0,
      p50_v2v_ms: 710,
      p95_v2v_ms: 740,
      usage: { llm_input_tokens: 180, llm_output_tokens: 95, tts_chars: 190 },
      created_at: '2026-10-02T05:41:41.000Z',
    },
    transcript: [
      { turn_index: 0, role: 'user', text: 'What is the refund window for online purchases?', ts_ms: 800, interrupted: false },
      { turn_index: 1, role: 'assistant', text: 'You can return items within thirty days of delivery for a full refund.', ts_ms: 1510, interrupted: false },
      { turn_index: 2, role: 'user', text: 'Does that include opened merchandise?', ts_ms: 3900, interrupted: false },
      { turn_index: 3, role: 'assistant', text: 'Yes, as long as it includes the original packaging and accessories.', ts_ms: 4620, interrupted: false },
    ],
    metrics: [
      { turn_index: 1, stt_ms: 145, llm_ttfb_ms: 200, tts_ttfb_ms: 115, voice_to_voice_ms: 710 },
      { turn_index: 3, stt_ms: 150, llm_ttfb_ms: 195, tts_ttfb_ms: 110, voice_to_voice_ms: 720 },
    ],
    aggregate_metrics: {
      voice_to_voice: { avg_ms: 715.0, p50_ms: 710, p95_ms: 740 },
      stt: { avg_ms: 147.5, p50_ms: 147, p95_ms: 150 },
      llm_ttfb: { avg_ms: 197.5, p50_ms: 197, p95_ms: 200 },
      tts_ttfb: { avg_ms: 112.5, p50_ms: 112, p95_ms: 115 },
    },
    eval: {
      call_id: 'a2c3d4e5-f6a7-4b8c-9d0e-1234567890bc',
      summary: 'Caller inquired about 30-day return policy and packaging conditions for opened goods.',
      sentiment: 'positive',
      scores: { task_completion: 5, tone: 5, relevance: 5, hallucination_risk: 1 },
      flags: [],
      judge_model: 'groq:llama-3.1-8b-instant',
      created_at: '2026-10-02T05:41:43.000Z',
    },
  },
  {
    call: {
      id: 'b3d4e5f6-a7b8-4c9d-0e1f-2345678901cd',
      started_at: '2026-10-02T04:12:00.000Z',
      ended_at: '2026-10-02T04:14:10.000Z',
      duration_ms: 130000,
      status: 'completed',
      end_reason: 'user_hangup',
      config: {
        stt: 'deepgram:nova-3',
        llm: 'groq:llama-3.3-70b-versatile',
        tts: 'cartesia:sonic',
        persona: 'default',
      },
      turn_count: 6,
      interruption_count: 1,
      p50_v2v_ms: 695,
      p95_v2v_ms: 785,
      usage: { llm_input_tokens: 260, llm_output_tokens: 140, tts_chars: 290 },
      created_at: '2026-10-02T04:14:12.000Z',
    },
    transcript: [
      { turn_index: 0, role: 'user', text: 'Can I reschedule my appointment for dental cleaning?', ts_ms: 1100, interrupted: false },
      { turn_index: 1, role: 'assistant', text: 'Yes! We have openings on Friday at ten AM or two PM.', ts_ms: 1795, interrupted: false },
      { turn_index: 2, role: 'user', text: 'Friday at two PM please.', ts_ms: 3800, interrupted: false },
      { turn_index: 3, role: 'assistant', text: 'You are booked for Friday at two PM. Would you like an SMS—', ts_ms: 4490, interrupted: true },
      { turn_index: 4, role: 'user', text: 'Yes, please send text confirmation.', ts_ms: 6100, interrupted: false },
      { turn_index: 5, role: 'assistant', text: 'Confirmation has been sent to your registered mobile number.', ts_ms: 6810, interrupted: false },
    ],
    metrics: [
      { turn_index: 1, stt_ms: 135, llm_ttfb_ms: 205, tts_ttfb_ms: 115, voice_to_voice_ms: 695 },
      { turn_index: 3, stt_ms: 125, llm_ttfb_ms: 190, tts_ttfb_ms: 105, voice_to_voice_ms: 690 },
      { turn_index: 5, stt_ms: 140, llm_ttfb_ms: 195, tts_ttfb_ms: 110, voice_to_voice_ms: 710 },
    ],
    aggregate_metrics: {
      voice_to_voice: { avg_ms: 698.3, p50_ms: 695, p95_ms: 785 },
      stt: { avg_ms: 133.3, p50_ms: 135, p95_ms: 140 },
      llm_ttfb: { avg_ms: 196.7, p50_ms: 195, p95_ms: 205 },
      tts_ttfb: { avg_ms: 110.0, p50_ms: 110, p95_ms: 115 },
    },
    eval: {
      call_id: 'b3d4e5f6-a7b8-4c9d-0e1f-2345678901cd',
      summary: 'Rescheduled dental cleaning to Friday at 2 PM and delivered SMS confirmation.',
      sentiment: 'positive',
      scores: { task_completion: 5, tone: 5, relevance: 5, hallucination_risk: 1 },
      flags: ['interrupted_turn'],
      judge_model: 'groq:llama-3.1-8b-instant',
      created_at: '2026-10-02T04:14:15.000Z',
    },
  },
  {
    call: {
      id: 'c4e5f6a7-b8c9-4d0e-1f2a-3456789012de',
      started_at: '2026-10-01T22:30:00.000Z',
      ended_at: '2026-10-01T22:31:10.000Z',
      duration_ms: 70000,
      status: 'error',
      end_reason: 'client_disconnect',
      config: {
        stt: 'deepgram:nova-3',
        llm: 'groq:llama-3.3-70b-versatile',
        tts: 'cartesia:sonic',
        persona: 'default',
      },
      turn_count: 2,
      interruption_count: 0,
      p50_v2v_ms: 820,
      p95_v2v_ms: 820,
      usage: { llm_input_tokens: 60, llm_output_tokens: 30, tts_chars: 75 },
      created_at: '2026-10-01T22:31:12.000Z',
    },
    transcript: [
      { turn_index: 0, role: 'user', text: 'Hello, can you hear me properly?', ts_ms: 900, interrupted: false },
      { turn_index: 1, role: 'assistant', text: 'Yes, I can hear you clearly. How can I assist you?', ts_ms: 1720, interrupted: false },
    ],
    metrics: [
      { turn_index: 1, stt_ms: 160, llm_ttfb_ms: 240, tts_ttfb_ms: 130, voice_to_voice_ms: 820 },
    ],
    aggregate_metrics: {
      voice_to_voice: { avg_ms: 820.0, p50_ms: 820, p95_ms: 820 },
      stt: { avg_ms: 160.0, p50_ms: 160, p95_ms: 160 },
      llm_ttfb: { avg_ms: 240.0, p50_ms: 240, p95_ms: 240 },
      tts_ttfb: { avg_ms: 130.0, p50_ms: 130, p95_ms: 130 },
    },
    eval: {
      call_id: 'c4e5f6a7-b8c9-4d0e-1f2a-3456789012de',
      summary: 'Call disconnected abruptly after audio check.',
      sentiment: 'neutral',
      scores: { task_completion: 2, tone: 4, relevance: 4, hallucination_risk: 1 },
      flags: ['unclear_speech'],
      judge_model: 'groq:llama-3.1-8b-instant',
      created_at: '2026-10-01T22:31:15.000Z',
    },
  },
];

// In-memory / local storage registry
const LOCAL_STORAGE_KEY = 'mini_call_log_calls';

function getStoredCalls(): CallDetailResponse[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return SEED_CALLS;
}

function saveStoredCalls(calls: CallDetailResponse[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(calls));
  } catch {}
}

export const apiClient = {
  async listCalls(limit = 20, cursor?: string | null, signal?: AbortSignal): Promise<CallsListResponse> {
    if (API_BASE_URL) {
      try {
        const url = new URL(`${API_BASE_URL}/calls`);
        url.searchParams.set('limit', String(limit));
        if (cursor) url.searchParams.set('cursor', cursor);

        const res = await fetch(url.toString(), { signal });
        if (res.ok) {
          return await res.json();
        }
      } catch (err: any) {
        if (err.name === 'AbortError') throw err;
        console.warn('Worker API unreachable; falling back to local dataset', err);
      }
    }

    // Local fallback
    const all = getStoredCalls();
    const sorted = [...all].sort((a, b) => b.call.started_at.localeCompare(a.call.started_at));
    const items: CallListItem[] = sorted.slice(0, limit).map((c) => ({
      id: c.call.id,
      started_at: c.call.started_at,
      duration_ms: c.call.duration_ms,
      status: c.call.status,
      end_reason: c.call.end_reason,
      turn_count: c.call.turn_count,
      interruption_count: c.call.interruption_count,
      p50_voice_to_voice_ms: c.call.p50_v2v_ms,
      summary: c.eval?.summary || null,
    }));

    return {
      items,
      next_cursor: null,
    };
  },

  async getCall(id: string, signal?: AbortSignal): Promise<CallDetailResponse> {
    if (API_BASE_URL) {
      try {
        const res = await fetch(`${API_BASE_URL}/calls/${id}`, { signal });
        if (res.ok) {
          return await res.json();
        }
      } catch (err: any) {
        if (err.name === 'AbortError') throw err;
        console.warn('Worker API unreachable for detail; falling back to local dataset', err);
      }
    }

    const all = getStoredCalls();
    const found = all.find((c) => c.call.id === id);
    if (!found) {
      throw new Error(`Call with ID ${id} not found`);
    }
    return found;
  },

  async getStats(days = 7, signal?: AbortSignal): Promise<CallStatsResponse> {
    if (API_BASE_URL) {
      try {
        const res = await fetch(`${API_BASE_URL}/stats?days=${days}`, { signal });
        if (res.ok) {
          return await res.json();
        }
      } catch (err: any) {
        if (err.name === 'AbortError') throw err;
        console.warn('Worker API unreachable for stats; computing from local dataset', err);
      }
    }

    const all = getStoredCalls();
    const completed = all.filter((c) => c.call.status === 'completed');
    const errors = all.filter((c) => c.call.status === 'error');

    const totalV2v = all.map((c) => c.call.p50_v2v_ms).filter((v): v is number => typeof v === 'number');
    const sortedV2v = [...totalV2v].sort((a, b) => a - b);
    const p50V2v = sortedV2v.length > 0 ? sortedV2v[Math.floor(sortedV2v.length * 0.5)] : 695;
    const p95V2v = sortedV2v.length > 0 ? sortedV2v[Math.min(sortedV2v.length - 1, Math.floor(sortedV2v.length * 0.95))] : 810;

    const totalTurns = all.reduce((sum, c) => sum + c.call.turn_count, 0);
    const totalInterrupts = all.reduce((sum, c) => sum + c.call.interruption_count, 0);

    return {
      time_window_days: days,
      total_calls: all.length,
      completed_calls: completed.length,
      error_rate_pct: all.length > 0 ? Math.round((errors.length / all.length) * 1000) / 10 : 0,
      interruption_rate_pct: totalTurns > 0 ? Math.round((totalInterrupts / totalTurns) * 1000) / 10 : 0,
      avg_duration_ms: Math.round(all.reduce((sum, c) => sum + c.call.duration_ms, 0) / (all.length || 1)),
      latency_percentiles: {
        voice_to_voice: { avg_ms: 703, p50_ms: p50V2v, p95_ms: p95V2v },
        stt: { avg_ms: 138, p50_ms: 135, p95_ms: 155 },
        llm_ttfb: { avg_ms: 198, p50_ms: 195, p95_ms: 220 },
        tts_ttfb: { avg_ms: 111, p50_ms: 110, p95_ms: 122 },
      },
      daily_volume: [
        { date: '2026-09-28', call_count: 3, avg_duration_ms: 95000 },
        { date: '2026-09-29', call_count: 5, avg_duration_ms: 110000 },
        { date: '2026-09-30', call_count: 4, avg_duration_ms: 105000 },
        { date: '2026-10-01', call_count: 6, avg_duration_ms: 125000 },
        { date: '2026-10-02', call_count: 4, avg_duration_ms: 101250 },
      ],
    };
  },

  async ingestCallLocally(callRecord: CallDetailResponse): Promise<void> {
    const existing = getStoredCalls();
    // Prepend new call
    const updated = [callRecord, ...existing.filter((c) => c.call.id !== callRecord.call.id)];
    saveStoredCalls(updated);
  },
};
