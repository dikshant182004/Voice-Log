-- Migration 0001: Initial schema for calls, transcripts, and per-turn metrics
-- D1 / SQLite schema with foreign keys and indexes

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  end_reason TEXT,
  config_json TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  interruption_count INTEGER NOT NULL DEFAULT 0,
  p50_v2v_ms INTEGER,
  p95_v2v_ms INTEGER,
  usage_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  ts_ms INTEGER,
  interrupted INTEGER NOT NULL DEFAULT 0,
  UNIQUE(call_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_transcripts_call_id ON transcripts(call_id, turn_index);

CREATE TABLE IF NOT EXISTS call_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  stt_ms INTEGER,
  llm_ttfb_ms INTEGER,
  tts_ttfb_ms INTEGER,
  voice_to_voice_ms INTEGER,
  UNIQUE(call_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_metrics_call_id ON call_metrics(call_id, turn_index);
