-- Migration 0003: Store evaluation flags array as JSON in call_evals
ALTER TABLE call_evals ADD COLUMN flags_json TEXT DEFAULT '[]';
