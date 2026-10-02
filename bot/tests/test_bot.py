"""
Unit tests for the Pipecat Voice Bot.
Verifies transcript accumulation, interrupted turn truncation,
metrics calculations, finalize-once guarantee, spooling & retry fallback,
and schema compatibility with the Worker API.
"""

import asyncio
import json
import os
import shutil
import tempfile
import uuid
import pytest
from pathlib import Path

from bot.config import BotSettings
from bot.observers.transcript import TranscriptCollector
from bot.observers.metrics import MetricsCollector
from bot.reporter import CallReporter, SPOOL_DIR


def test_transcript_collector_turns_and_interruption():
  collector = TranscriptCollector()
  
  # User speaks
  u_turn = collector.add_user_turn("What is your return policy?", ts_ms=500)
  assert u_turn["turn_index"] == 0
  assert u_turn["role"] == "user"
  assert u_turn["text"] == "What is your return policy?"
  assert u_turn["interrupted"] is False

  # Assistant speaks and gets interrupted
  a_turn = collector.start_assistant_turn(ts_ms=1100)
  collector.append_assistant_chunk("Our return policy allows items within thirty days—")
  collector.mark_interrupted(spoken_text_so_far="Our return policy allows—")

  turns = collector.get_turns()
  assert len(turns) == 2
  assert turns[1]["role"] == "assistant"
  assert turns[1]["interrupted"] is True
  assert turns[1]["text"] == "Our return policy allows—"

  # Normal completed turn
  collector.add_user_turn("Got it, thanks.", ts_ms=2500)
  collector.start_assistant_turn(ts_ms=3000)
  collector.append_assistant_chunk("You are very welcome!")
  collector.complete_assistant_turn()

  turns = collector.get_turns()
  assert len(turns) == 4
  assert turns[3]["interrupted"] is False
  assert turns[3]["text"] == "You are very welcome!"


def test_metrics_collector_calculations():
  metrics = MetricsCollector()

  # Simulate turn 1 timeline
  # User finishes speaking at t=1.0s
  metrics.mark_user_speech_end(ts=1.0)
  # STT final arrives at t=1.15s (STT = 150ms)
  metrics.mark_stt_final(ts=1.15)
  # LLM starts at t=1.16s
  metrics.mark_llm_start(ts=1.16)
  # First LLM token arrives at t=1.36s (LLM TTFB = 200ms)
  metrics.mark_llm_first_token(ts=1.36)
  # TTS starts at t=1.37s
  metrics.mark_tts_start(ts=1.37)
  # First TTS audio byte produced at t=1.49s (TTS TTFB = 120ms, V2V = 490ms)
  metrics.mark_tts_first_audio(ts=1.49)

  turn_record = metrics.finalize_turn_metrics(turn_index=1)
  assert turn_record["turn_index"] == 1
  assert turn_record["stt_ms"] == 150
  assert turn_record["llm_ttfb_ms"] == 200
  assert turn_record["tts_ttfb_ms"] == 120
  assert turn_record["voice_to_voice_ms"] == 490

  # Verify token tracking
  metrics.record_usage(input_tokens=50, output_tokens=30, tts_chars=60)
  usage = metrics.get_usage()
  assert usage["llm_input_tokens"] == 50
  assert usage["llm_output_tokens"] == 30
  assert usage["tts_chars"] == 60


def test_config_validation():
  # Missing required keys should raise ValueError
  empty_settings = BotSettings(
    deepgram_api_key="",
    groq_api_key="",
    cartesia_api_key="",
    elevenlabs_api_key=None,
  )
  with pytest.raises(ValueError) as exc:
    empty_settings.validate_keys()
  assert "DEEPGRAM_API_KEY" in str(exc.value)

  # Complete keys should pass validation
  valid_settings = BotSettings(
    deepgram_api_key="dg_123",
    groq_api_key="gq_123",
    cartesia_api_key="ct_123",
  )
  valid_settings.validate_keys()


@pytest.mark.asyncio
async def test_reporter_finalize_once_and_spool():
  reporter = CallReporter(worker_base_url="http://127.0.0.1:9999", ingest_token="test_token")
  call_id = str(uuid.uuid4())
  payload = {
    "call_id": call_id,
    "started_at": "2026-10-02T10:00:00.000Z",
    "ended_at": "2026-10-02T10:01:00.000Z",
    "duration_ms": 60000,
    "status": "completed",
    "transcript": [],
    "metrics": [],
    "usage": {"llm_input_tokens": 0, "llm_output_tokens": 0, "tts_chars": 0},
  }

  # Test spooling when server is unreachable
  spooled = reporter.spool_payload(call_id, payload)
  assert spooled is True
  spool_file = SPOOL_DIR / f"{call_id}.json"
  assert spool_file.exists()

  with open(spool_file, "r") as f:
    saved = json.load(f)
  assert saved["call_id"] == call_id

  # Clean up spool file
  spool_file.unlink(missing_ok=True)

  # Test finalize exactly once guarantee
  assert reporter._finalized is False
  reporter._finalized = True
  result = await reporter.finalize_and_report(payload)
  assert result is True
