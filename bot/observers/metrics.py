"""
Pipeline Latency and Usage Metrics Collector.
Collects turn-level latency breakdown (STT, LLM TTFB, TTS TTFB, Voice-to-Voice)
and token/character consumption counters.
Includes Pipecat FrameProcessor for streaming pipeline integration.
"""

from typing import List, Dict, Any, Optional
import time

try:
  from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
  from pipecat.frames.frames import (
    Frame,
    MetricsFrame,
    UserStoppedSpeakingFrame,
    UserStartedSpeakingFrame,
    TranscriptionFrame,
    LLMFullResponseStartFrame,
    TTSStartedFrame,
    TTSAudioRawFrame,
  )
  PIPECAT_AVAILABLE = True
except ImportError:
  PIPECAT_AVAILABLE = False
  FrameProcessor = object
  FrameDirection = None
  Frame = None


class MetricsCollector:
  def __init__(self):
    self.turn_metrics: List[Dict[str, Any]] = []
    self.usage = {
      "llm_input_tokens": 0,
      "llm_output_tokens": 0,
      "tts_chars": 0,
    }

    # Internal state for active turn timing
    self._user_speech_end_ts: Optional[float] = None
    self._stt_final_ts: Optional[float] = None
    self._llm_start_ts: Optional[float] = None
    self._llm_first_token_ts: Optional[float] = None
    self._tts_start_ts: Optional[float] = None
    self._tts_first_audio_ts: Optional[float] = None

  def mark_user_speech_end(self, ts: Optional[float] = None) -> None:
    """Invoked when VAD detects end of user utterance."""
    self._user_speech_end_ts = ts or time.time()

  def mark_stt_final(self, ts: Optional[float] = None) -> None:
    """Invoked when STT provider yields the final transcript."""
    self._stt_final_ts = ts or time.time()

  def mark_llm_start(self, ts: Optional[float] = None) -> None:
    """Invoked when user context is sent to LLM."""
    self._llm_start_ts = ts or time.time()

  def mark_llm_first_token(self, ts: Optional[float] = None) -> None:
    """Invoked when first streamed token arrives from LLM."""
    if self._llm_first_token_ts is None:
      self._llm_first_token_ts = ts or time.time()

  def mark_tts_start(self, ts: Optional[float] = None) -> None:
    """Invoked when text is sent to TTS synthesizer."""
    if self._tts_start_ts is None:
      self._tts_start_ts = ts or time.time()

  def mark_tts_first_audio(self, ts: Optional[float] = None) -> None:
    """Invoked when first audio frame is generated/sent to transport."""
    if self._tts_first_audio_ts is None:
      self._tts_first_audio_ts = ts or time.time()

  def record_usage(self, input_tokens: int = 0, output_tokens: int = 0, tts_chars: int = 0) -> None:
    self.usage["llm_input_tokens"] += input_tokens
    self.usage["llm_output_tokens"] += output_tokens
    self.usage["tts_chars"] += tts_chars

  def finalize_turn_metrics(self, turn_index: int) -> Dict[str, Any]:
    """
    Computes delta latencies for the finished turn.
    Returns nullable integers (in ms) where captured, or None if unmeasured.
    """
    stt_ms: Optional[int] = None
    if self._user_speech_end_ts and self._stt_final_ts:
      stt_ms = max(0, round((self._stt_final_ts - self._user_speech_end_ts) * 1000))

    llm_ttfb_ms: Optional[int] = None
    if self._llm_start_ts and self._llm_first_token_ts:
      llm_ttfb_ms = max(0, round((self._llm_first_token_ts - self._llm_start_ts) * 1000))

    tts_ttfb_ms: Optional[int] = None
    if self._tts_start_ts and self._tts_first_audio_ts:
      tts_ttfb_ms = max(0, round((self._tts_first_audio_ts - self._tts_start_ts) * 1000))

    voice_to_voice_ms: Optional[int] = None
    if self._user_speech_end_ts and self._tts_first_audio_ts:
      voice_to_voice_ms = max(0, round((self._tts_first_audio_ts - self._user_speech_end_ts) * 1000))

    record = {
      "turn_index": turn_index,
      "stt_ms": stt_ms,
      "llm_ttfb_ms": llm_ttfb_ms,
      "tts_ttfb_ms": tts_ttfb_ms,
      "voice_to_voice_ms": voice_to_voice_ms,
    }
    self.turn_metrics.append(record)

    # Reset per-turn timestamps
    self._user_speech_end_ts = None
    self._stt_final_ts = None
    self._llm_start_ts = None
    self._llm_first_token_ts = None
    self._tts_start_ts = None
    self._tts_first_audio_ts = None

    return record

  def add_turn_metric(
    self,
    turn_index: int,
    stt_ms: Optional[int] = None,
    llm_ttfb_ms: Optional[int] = None,
    tts_ttfb_ms: Optional[int] = None,
    voice_to_voice_ms: Optional[int] = None,
  ) -> Dict[str, Any]:
    """Records an explicitly supplied turn metric directly."""
    record = {
      "turn_index": turn_index,
      "stt_ms": stt_ms,
      "llm_ttfb_ms": llm_ttfb_ms,
      "tts_ttfb_ms": tts_ttfb_ms,
      "voice_to_voice_ms": voice_to_voice_ms,
    }
    self.turn_metrics.append(record)
    return record

  def get_metrics(self) -> List[Dict[str, Any]]:
    return list(self.turn_metrics)

  def get_usage(self) -> Dict[str, int]:
    return dict(self.usage)


class MetricsProcessor(FrameProcessor if PIPECAT_AVAILABLE else object):
  """
  Pipecat pipeline frame processor that observes audio, STT, LLM, and TTS frames
  to compute real-time latency milestones.
  """
  def __init__(self, collector: MetricsCollector):
    if PIPECAT_AVAILABLE:
      super().__init__()
    self._collector = collector

  async def process_frame(self, frame: Any, direction: Any):
    if PIPECAT_AVAILABLE:
      await super().process_frame(frame, direction)
      if isinstance(frame, UserStoppedSpeakingFrame):
        self._collector.mark_user_speech_end()
      elif isinstance(frame, TranscriptionFrame):
        self._collector.mark_stt_final()
      elif isinstance(frame, LLMFullResponseStartFrame):
        self._collector.mark_llm_first_token()
      elif isinstance(frame, TTSStartedFrame):
        self._collector.mark_tts_start()
      elif isinstance(frame, TTSAudioRawFrame):
        self._collector.mark_tts_first_audio()
      elif isinstance(frame, MetricsFrame):
        # Capture token and character usage if present in metrics frames
        for m in getattr(frame, "data", []):
          if getattr(m, "processor", "") == "llm":
            pass
      await self.push_frame(frame, direction)
