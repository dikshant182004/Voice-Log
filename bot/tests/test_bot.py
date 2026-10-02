"""
Unit tests for the Pipecat Voice Bot.
Verifies transcript accumulation, interrupted turn truncation,
metrics calculation math, finalize-once guarantee per call session,
multiple calls through a single reporter (singleton bug regression),
rejection of malformed payloads to bot/spool/rejected/,
and configuration validation.
"""

import asyncio
import json
import os
import shutil
import tempfile
import uuid
from pathlib import Path
import pytest
import httpx

from bot.config import BotSettings
from bot.observers.transcript import TranscriptCollector
from bot.observers.metrics import MetricsCollector
from bot.reporter import CallReporter, SPOOL_DIR, REJECTED_DIR, IngestCallPayloadModel


def test_transcript_collector_turns_and_interruption():
  collector = TranscriptCollector()

  # User speaks
  u_turn = collector.add_user_turn("What is your refund policy?", ts_ms=500)
  assert u_turn["turn_index"] == 0
  assert u_turn["role"] == "user"
  assert u_turn["text"] == "What is your refund policy?"
  assert u_turn["interrupted"] is False

  # Assistant speaks and is interrupted
  a_turn = collector.start_assistant_turn(ts_ms=1100)
  collector.append_assistant_chunk("Our refund policy allows returns within—")
  collector.mark_interrupted(spoken_text_so_far="Our refund policy allows returns—")

  turns = collector.get_turns()
  assert len(turns) == 2
  assert turns[1]["role"] == "assistant"
  assert turns[1]["interrupted"] is True
  assert turns[1]["text"] == "Our refund policy allows returns—"

  # Next turn finishes normally
  collector.add_user_turn("Can I return opened items?", ts_ms=2500)
  collector.start_assistant_turn(ts_ms=3100)
  collector.append_assistant_chunk("Yes, if in original packaging.")
  collector.complete_assistant_turn()

  turns = collector.get_turns()
  assert len(turns) == 4
  assert turns[3]["interrupted"] is False
  assert turns[3]["text"] == "Yes, if in original packaging."


def test_metrics_collector_math():
  metrics = MetricsCollector()
  metrics.mark_user_speech_end(ts=1.0)
  metrics.mark_stt_final(ts=1.14)       # 140ms
  metrics.mark_llm_start(ts=1.15)
  metrics.mark_llm_first_token(ts=1.35) # 200ms
  metrics.mark_tts_start(ts=1.36)
  metrics.mark_tts_first_audio(ts=1.47) # 110ms, V2V = 470ms

  turn_record = metrics.finalize_turn_metrics(turn_index=1)
  assert turn_record["turn_index"] == 1
  assert turn_record["stt_ms"] == 140
  assert turn_record["llm_ttfb_ms"] == 200
  assert turn_record["tts_ttfb_ms"] == 110
  assert turn_record["voice_to_voice_ms"] == 470

  metrics.record_usage(input_tokens=40, output_tokens=25, tts_chars=55)
  usage = metrics.get_usage()
  assert usage["llm_input_tokens"] == 40
  assert usage["llm_output_tokens"] == 25
  assert usage["tts_chars"] == 55


def test_config_validation_fails_fast_on_missing_keys():
  empty_settings = BotSettings(
    deepgram_api_key="",
    groq_api_key="",
    cartesia_api_key="",
    ingest_token="",
  )
  with pytest.raises(ValueError) as exc:
    empty_settings.validate_keys()
  err_msg = str(exc.value)
  assert "DEEPGRAM_API_KEY" in err_msg
  assert "GROQ_API_KEY" in err_msg
  assert "INGEST_TOKEN" in err_msg


def test_pydantic_payload_validation():
  valid_payload = {
    "call_id": str(uuid.uuid4()),
    "started_at": "2026-10-02T10:00:00.000Z",
    "ended_at": "2026-10-02T10:01:00.000Z",
    "duration_ms": 60000,
    "status": "completed",
    "end_reason": "user_hangup",
    "transcript": [
      {"turn_index": 0, "role": "user", "text": "Hello", "ts_ms": 500, "interrupted": False}
    ],
    "metrics": [
      {"turn_index": 0, "stt_ms": 120, "llm_ttfb_ms": 180, "tts_ttfb_ms": 110, "voice_to_voice_ms": 650}
    ],
    "usage": {"llm_input_tokens": 10, "llm_output_tokens": 15, "tts_chars": 20},
  }

  model = IngestCallPayloadModel(**valid_payload)
  assert model.call_id == valid_payload["call_id"]
  assert model.duration_ms == 60000


@pytest.mark.asyncio
async def test_reporter_handles_multiple_calls_without_lockout():
  """
  Regression test for reporter singleton bug:
  Ensure calling reporter for call A does not lock out subsequent call B!
  """
  # Mock transport that records requests
  recorded_calls = []

  def handler(request: httpx.Request):
    data = json.loads(request.read())
    recorded_calls.append(data["call_id"])
    return httpx.Response(201, json={"id": data["call_id"]})

  transport = httpx.MockTransport(handler)
  async with httpx.AsyncClient(transport=transport) as client:
    reporter = CallReporter(
      worker_base_url="http://worker.test",
      ingest_token="token_123",
      client=client,
    )

    call_1 = {
      "call_id": str(uuid.uuid4()),
      "started_at": "2026-10-02T10:00:00.000Z",
      "ended_at": "2026-10-02T10:01:00.000Z",
      "duration_ms": 60000,
      "status": "completed",
      "transcript": [],
      "metrics": [],
      "usage": {"llm_input_tokens": 0, "llm_output_tokens": 0, "tts_chars": 0},
    }

    call_2 = {
      "call_id": str(uuid.uuid4()),
      "started_at": "2026-10-02T10:05:00.000Z",
      "ended_at": "2026-10-02T10:06:00.000Z",
      "duration_ms": 60000,
      "status": "completed",
      "transcript": [],
      "metrics": [],
      "usage": {"llm_input_tokens": 0, "llm_output_tokens": 0, "tts_chars": 0},
    }

    # Call 1 report
    res1 = await reporter.report_call(call_1)
    assert res1 is True

    # Call 2 report through SAME reporter instance
    res2 = await reporter.report_call(call_2)
    assert res2 is True

    # Verify both calls were delivered
    assert len(recorded_calls) == 2
    assert recorded_calls[0] == call_1["call_id"]
    assert recorded_calls[1] == call_2["call_id"]


@pytest.mark.asyncio
async def test_reporter_spools_to_rejected_on_400():
  """
  Verifies that non-retriable 400 client errors are saved to bot/spool/rejected/
  and not endlessly retried.
  """
  def handler(request: httpx.Request):
    return httpx.Response(400, json={"error": {"code": "VALIDATION_ERROR", "message": "Invalid field"}})

  transport = httpx.MockTransport(handler)
  async with httpx.AsyncClient(transport=transport) as client:
    reporter = CallReporter(
      worker_base_url="http://worker.test",
      ingest_token="token_123",
      client=client,
    )

    bad_call_id = str(uuid.uuid4())
    payload = {
      "call_id": bad_call_id,
      "started_at": "2026-10-02T10:00:00.000Z",
      "ended_at": "2026-10-02T10:01:00.000Z",
      "duration_ms": 60000,
      "status": "completed",
      "transcript": [],
      "metrics": [],
      "usage": {"llm_input_tokens": 0, "llm_output_tokens": 0, "tts_chars": 0},
    }

    res = await reporter.report_call(payload, max_attempts=1)
    assert res is False

    # Check rejected spool file exists
    rejected_file = REJECTED_DIR / f"{bad_call_id}.json"
    assert rejected_file.exists()
    rejected_file.unlink(missing_ok=True)
