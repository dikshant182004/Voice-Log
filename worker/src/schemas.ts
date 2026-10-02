import { z } from 'zod';

/**
 * Single source of truth Zod schemas for the Mini Call Log Service API contract.
 * Shared between Cloudflare Worker, tests, and frontend consumers.
 */

export const CallConfigSchema = z.object({
  stt: z.string().default('deepgram:nova-3-general'),
  llm: z.string().default('groq:openai/gpt-oss-20b'),
  tts: z.string().default('cartesia:sonic-3.6'),
  persona: z.string().default('default'),
});

export const TranscriptTurnSchema = z.object({
  turn_index: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant', 'system']),
  text: z.string().max(4000),
  ts_ms: z.number().int().nonnegative().optional().default(0),
  interrupted: z.boolean().optional().default(false),
});

export const TurnMetricSchema = z.object({
  turn_index: z.number().int().nonnegative(),
  stt_ms: z.number().int().nonnegative().nullable().optional(),
  llm_ttfb_ms: z.number().int().nonnegative().nullable().optional(),
  tts_ttfb_ms: z.number().int().nonnegative().nullable().optional(),
  voice_to_voice_ms: z.number().int().nonnegative().nullable().optional(),
});

export const UsageSchema = z.object({
  llm_input_tokens: z.number().int().nonnegative().default(0),
  llm_output_tokens: z.number().int().nonnegative().default(0),
  tts_chars: z.number().int().nonnegative().default(0),
});

export const PostCallPayloadSchema = z.object({
  call_id: z.string().uuid({ message: 'call_id must be a valid UUID v4/v7' }),
  started_at: z.string().datetime({ message: 'started_at must be an ISO-8601 UTC string' }),
  ended_at: z.string().datetime({ message: 'ended_at must be an ISO-8601 UTC string' }),
  duration_ms: z.number().int().nonnegative(),
  status: z.enum(['completed', 'disconnected', 'error']),
  end_reason: z.enum(['user_hangup', 'client_disconnect', 'error', 'timeout']).nullable().optional(),
  config: CallConfigSchema.default({
    stt: 'deepgram:nova-3-general',
    llm: 'groq:openai/gpt-oss-20b',
    tts: 'cartesia:sonic-3.6',
    persona: 'default',
  }),
  transcript: z.array(TranscriptTurnSchema).max(500, { message: 'Max 500 turns allowed per call' }).default([]),
  metrics: z.array(TurnMetricSchema).max(500).default([]),
  usage: UsageSchema.default({
    llm_input_tokens: 0,
    llm_output_tokens: 0,
    tts_chars: 0,
  }),
});

export type PostCallPayload = z.infer<typeof PostCallPayloadSchema>;

export const CallListItemSchema = z.object({
  id: z.string(),
  started_at: z.string(),
  duration_ms: z.number(),
  status: z.string(),
  end_reason: z.string().nullable().optional(),
  turn_count: z.number(),
  interruption_count: z.number().optional(),
  p50_voice_to_voice_ms: z.number().nullable().optional(),
  summary: z.string().nullable().optional(),
});

export type CallListItem = z.infer<typeof CallListItemSchema>;

export const CallsListResponseSchema = z.object({
  items: z.array(CallListItemSchema),
  next_cursor: z.string().nullable(),
});

export type CallsListResponse = z.infer<typeof CallsListResponseSchema>;

export const StepMetricStatsSchema = z.object({
  avg_ms: z.number().nullable(),
  p50_ms: z.number().nullable(),
  p95_ms: z.number().nullable(),
  sample_size: z.number().int().nonnegative().optional().default(0),
});

export const AggregateMetricsSchema = z.object({
  voice_to_voice: StepMetricStatsSchema,
  stt: StepMetricStatsSchema,
  llm_ttfb: StepMetricStatsSchema,
  tts_ttfb: StepMetricStatsSchema,
});

export type AggregateMetrics = z.infer<typeof AggregateMetricsSchema>;

export const CallEvalScoresSchema = z.object({
  task_completion: z.number().min(1).max(5),
  tone: z.number().min(1).max(5),
  relevance: z.number().min(1).max(5),
  hallucination_risk: z.number().min(1).max(5),
});

export const CallEvalSchema = z.object({
  call_id: z.string(),
  summary: z.string(),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  scores: CallEvalScoresSchema,
  flags: z.array(z.string()).default([]),
  judge_model: z.string(),
  created_at: z.string(),
});

export type CallEval = z.infer<typeof CallEvalSchema>;

export const CallDetailResponseSchema = z.object({
  call: z.object({
    id: z.string(),
    started_at: z.string(),
    ended_at: z.string(),
    duration_ms: z.number(),
    status: z.string(),
    end_reason: z.string().nullable().optional(),
    config: CallConfigSchema,
    turn_count: z.number(),
    interruption_count: z.number(),
    p50_v2v_ms: z.number().nullable().optional(),
    p95_v2v_ms: z.number().nullable().optional(),
    usage: UsageSchema,
    created_at: z.string(),
  }),
  transcript: z.array(TranscriptTurnSchema),
  metrics: z.array(TurnMetricSchema),
  aggregate_metrics: AggregateMetricsSchema,
  eval: CallEvalSchema.nullable().optional(),
});

export type CallDetailResponse = z.infer<typeof CallDetailResponseSchema>;

export const DailyVolumeSchema = z.object({
  date: z.string(),
  call_count: z.number(),
  avg_duration_ms: z.number(),
});

export const CallStatsResponseSchema = z.object({
  time_window_days: z.number(),
  total_calls: z.number(),
  completed_calls: z.number(),
  error_rate_pct: z.number(),
  interruption_rate_pct: z.number(),
  avg_duration_ms: z.number(),
  latency_percentiles: z.object({
    voice_to_voice: StepMetricStatsSchema,
    stt: StepMetricStatsSchema,
    llm_ttfb: StepMetricStatsSchema,
    tts_ttfb: StepMetricStatsSchema,
  }),
  daily_volume: z.array(DailyVolumeSchema),
});

export type CallStatsResponse = z.infer<typeof CallStatsResponseSchema>;

export const StandardErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string(),
    details: z.any().optional(),
  }),
});
