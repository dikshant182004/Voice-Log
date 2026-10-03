"""
Turn-level latency and usage metrics collected from actual Pipecat frames.
"""

from typing import Any, Dict, List, Optional
import time

try:
    from pipecat.frames.frames import (
        LLMFullResponseStartFrame,
        MetricsFrame,
        TextFrame,
        TTSAudioRawFrame,
        TTSStartedFrame,
        UserStoppedSpeakingFrame,
        VADUserStoppedSpeakingFrame,
    )
    from pipecat.processors.frame_processor import FrameProcessor
    PIPECAT_AVAILABLE = True
except ImportError:
    PIPECAT_AVAILABLE = False
    FrameProcessor = object
    UserStoppedSpeakingFrame = VADUserStoppedSpeakingFrame = object


class MetricsCollector:
    def __init__(self):
        self.turn_metrics: List[Dict[str, Any]] = []
        self.usage = {"llm_input_tokens": 0, "llm_output_tokens": 0, "tts_chars": 0}
        self._user_speech_end_ts: Optional[float] = None
        self._stt_final_ts: Optional[float] = None
        self._llm_start_ts: Optional[float] = None
        self._llm_first_token_ts: Optional[float] = None
        self._tts_start_ts: Optional[float] = None
        self._tts_first_audio_ts: Optional[float] = None
        self._current_turn_index: Optional[int] = None

    def mark_user_speech_end(self, ts=None):
        self._user_speech_end_ts = ts or time.time()
        self._current_turn_index = len(self.turn_metrics) * 2 + 1
    def mark_stt_final(self, ts=None): self._stt_final_ts = ts or time.time()
    def mark_llm_start(self, ts=None): self._llm_start_ts = ts or time.time()
    def mark_llm_first_token(self, ts=None):
        if self._llm_first_token_ts is None: self._llm_first_token_ts = ts or time.time()
    def mark_tts_start(self, ts=None):
        if self._tts_start_ts is None: self._tts_start_ts = ts or time.time()
    def mark_tts_first_audio(self, ts=None):
        if self._tts_first_audio_ts is None: self._tts_first_audio_ts = ts or time.time()

    def record_usage(self, input_tokens=0, output_tokens=0, tts_chars=0):
        self.usage["llm_input_tokens"] += input_tokens
        self.usage["llm_output_tokens"] += output_tokens
        self.usage["tts_chars"] += tts_chars

    def finalize_turn_metrics(self, turn_index: int) -> Dict[str, Any]:
        def elapsed(start, end):
            return None if start is None or end is None else max(0, round((end - start) * 1000))
        record = {
            "turn_index": turn_index,
            "stt_ms": elapsed(self._user_speech_end_ts, self._stt_final_ts),
            "llm_ttfb_ms": elapsed(self._llm_start_ts, self._llm_first_token_ts),
            "tts_ttfb_ms": elapsed(self._tts_start_ts, self._tts_first_audio_ts),
            "voice_to_voice_ms": elapsed(self._user_speech_end_ts, self._tts_first_audio_ts),
        }
        self.turn_metrics.append(record)
        self._user_speech_end_ts = self._stt_final_ts = self._llm_start_ts = None
        self._llm_first_token_ts = self._tts_start_ts = self._tts_first_audio_ts = None
        self._current_turn_index = None
        return record

    def get_metrics(self): return list(self.turn_metrics)
    def get_usage(self): return dict(self.usage)


class MetricsProcessor(FrameProcessor if PIPECAT_AVAILABLE else object):
    def __init__(self, collector: MetricsCollector):
        if PIPECAT_AVAILABLE: super().__init__()
        self._collector = collector

    async def process_frame(self, frame: Any, direction: Any):
        if PIPECAT_AVAILABLE:
            await super().process_frame(frame, direction)
            if isinstance(frame, (UserStoppedSpeakingFrame, VADUserStoppedSpeakingFrame)):
                self._collector.mark_user_speech_end()
            elif frame.__class__.__name__ == "TranscriptionFrame":
                self._collector.mark_stt_final()
            elif isinstance(frame, LLMFullResponseStartFrame):
                self._collector.mark_llm_start()
            elif isinstance(frame, TextFrame) and self._collector._llm_start_ts is not None:
                self._collector.mark_llm_first_token()
            elif isinstance(frame, TTSStartedFrame):
                self._collector.mark_tts_start()
            elif isinstance(frame, TTSAudioRawFrame):
                self._collector.mark_tts_first_audio()
                if self._collector._current_turn_index is not None:
                    self._collector.finalize_turn_metrics(self._collector._current_turn_index)
            elif isinstance(frame, MetricsFrame):
                for metric in getattr(frame, "data", []):
                    if "llm" in str(getattr(metric, "processor", "")).lower():
                        self._collector.record_usage(
                            input_tokens=getattr(metric, "prompt_tokens", 0) or 0,
                            output_tokens=getattr(metric, "completion_tokens", 0) or 0,
                        )
            await self.push_frame(frame, direction)
