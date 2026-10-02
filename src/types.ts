/**
 * Frontend TypeScript contracts matching the Worker API schema and Python Bot models.
 */

export interface CallConfig {
  stt: string;
  llm: string;
  tts: string;
  persona: string;
}

export interface TranscriptTurn {
  turn_index: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
  ts_ms: number;
  interrupted?: boolean;
}

export interface TurnMetric {
  turn_index: number;
  stt_ms?: number | null;
  llm_ttfb_ms?: number | null;
  tts_ttfb_ms?: number | null;
  voice_to_voice_ms?: number | null;
}

export interface Usage {
  llm_input_tokens: number;
  llm_output_tokens: number;
  tts_chars: number;
}

export interface CallListItem {
  id: string;
  started_at: string;
  duration_ms: number;
  status: 'completed' | 'disconnected' | 'error';
  end_reason?: string | null;
  turn_count: number;
  interruption_count?: number;
  p50_voice_to_voice_ms?: number | null;
  summary?: string | null;
}

export interface CallsListResponse {
  items: CallListItem[];
  next_cursor: string | null;
}

export interface StepMetricStats {
  avg_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
}

export interface AggregateMetrics {
  voice_to_voice: StepMetricStats;
  stt: StepMetricStats;
  llm_ttfb: StepMetricStats;
  tts_ttfb: StepMetricStats;
}

export interface CallEvalScores {
  task_completion: number;
  tone: number;
  relevance: number;
  hallucination_risk: number;
}

export interface CallEval {
  call_id: string;
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  scores: CallEvalScores;
  flags: string[];
  judge_model: string;
  created_at: string;
}

export interface CallDetail {
  id: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: 'completed' | 'disconnected' | 'error';
  end_reason?: string | null;
  config: CallConfig;
  turn_count: number;
  interruption_count: number;
  p50_v2v_ms?: number | null;
  p95_v2v_ms?: number | null;
  usage: Usage;
  created_at: string;
}

export interface CallDetailResponse {
  call: CallDetail;
  transcript: TranscriptTurn[];
  metrics: TurnMetric[];
  aggregate_metrics: AggregateMetrics;
  eval?: CallEval | null;
}

export interface DailyVolume {
  date: string;
  call_count: number;
  avg_duration_ms: number;
}

export interface CallStatsResponse {
  time_window_days: number;
  total_calls: number;
  completed_calls: number;
  error_rate_pct: number;
  interruption_rate_pct: number;
  avg_duration_ms: number;
  latency_percentiles: {
    voice_to_voice: StepMetricStats;
    stt: StepMetricStats;
    llm_ttfb: StepMetricStats;
    tts_ttfb: StepMetricStats;
  };
  daily_volume: DailyVolume[];
}
