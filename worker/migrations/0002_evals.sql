-- Migration 0002: Advanced Feature 2 - Post-call LLM evaluation results
-- Stores async judge summary, sentiment, multi-dimensional scores, and latency/model metadata

CREATE TABLE IF NOT EXISTS call_evals (
  call_id TEXT PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  scores_json TEXT NOT NULL,
  summary TEXT,
  sentiment TEXT,
  judge_model TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evals_call_id ON call_evals(call_id);
