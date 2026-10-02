"""
Standard Library Test Runner for the Pipecat Voice Bot.
Runs without requiring external pip packages or virtual environments.
Complements pytest in CI and local setups.
"""

import asyncio
import json
import os
import sys
import unittest
import uuid
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from bot.observers.transcript import TranscriptCollector
from bot.observers.metrics import MetricsCollector
from bot.reporter import CallReporter, SPOOL_DIR


class TestTranscriptCollector(unittest.TestCase):
  def test_turns_and_interruption(self):
    collector = TranscriptCollector()
    
    # 1. User speaks
    u = collector.add_user_turn("What are your business hours?", ts_ms=200)
    self.assertEqual(u["turn_index"], 0)
    self.assertEqual(u["role"], "user")
    self.assertEqual(u["interrupted"], False)

    # 2. Assistant starts speaking and is interrupted
    collector.start_assistant_turn(ts_ms=800)
    collector.append_assistant_chunk("We are open weekdays from nine—")
    collector.mark_interrupted(spoken_text_so_far="We are open—")

    turns = collector.get_turns()
    self.assertEqual(len(turns), 2)
    self.assertEqual(turns[1]["role"], "assistant")
    self.assertEqual(turns[1]["interrupted"], True)
    self.assertEqual(turns[1]["text"], "We are open—")

    # 3. Completed turn
    collector.add_user_turn("Thanks!", ts_ms=1800)
    collector.start_assistant_turn(ts_ms=2300)
    collector.append_assistant_chunk("Happy to help!")
    collector.complete_assistant_turn()

    turns = collector.get_turns()
    self.assertEqual(len(turns), 4)
    self.assertEqual(turns[3]["interrupted"], False)
    self.assertEqual(turns[3]["text"], "Happy to help!")


class TestMetricsCollector(unittest.TestCase):
  def test_metrics_calculation(self):
    metrics = MetricsCollector()
    metrics.mark_user_speech_end(ts=1.0)
    metrics.mark_stt_final(ts=1.14)      # 140ms
    metrics.mark_llm_start(ts=1.15)
    metrics.mark_llm_first_token(ts=1.35) # 200ms
    metrics.mark_tts_start(ts=1.36)
    metrics.mark_tts_first_audio(ts=1.47) # 110ms, V2V = 470ms

    turn = metrics.finalize_turn_metrics(turn_index=1)
    self.assertEqual(turn["turn_index"], 1)
    self.assertEqual(turn["stt_ms"], 140)
    self.assertEqual(turn["llm_ttfb_ms"], 200)
    self.assertEqual(turn["tts_ttfb_ms"], 110)
    self.assertEqual(turn["voice_to_voice_ms"], 470)

    metrics.record_usage(input_tokens=40, output_tokens=25, tts_chars=55)
    usage = metrics.get_usage()
    self.assertEqual(usage["llm_input_tokens"], 40)
    self.assertEqual(usage["llm_output_tokens"], 25)
    self.assertEqual(usage["tts_chars"], 55)


class TestReporterSpooling(unittest.TestCase):
  def test_spool_payload_and_finalize_once(self):
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

    # Spool to disk
    spooled = reporter.spool_payload(call_id, payload)
    self.assertTrue(spooled)

    spool_file = SPOOL_DIR / f"{call_id}.json"
    self.assertTrue(spool_file.exists())

    with open(spool_file, "r") as f:
      loaded = json.load(f)
    self.assertEqual(loaded["call_id"], call_id)
    spool_file.unlink(missing_ok=True)

    # Finalize-once guarantee
    self.assertFalse(reporter._finalized)
    reporter._finalized = True
    result = asyncio.run(reporter.finalize_and_report(payload))
    self.assertTrue(result)


if __name__ == "__main__":
  unittest.main(verbosity=2)
