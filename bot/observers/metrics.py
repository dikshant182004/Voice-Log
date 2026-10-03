"""Turn-level latency and usage metrics collected from actual Pipecat frames."""

from typing import Any, Dict, List, Optional
import time

from pipecat.frames.frames import (
    LLMFullResponseStartFrame,
    MetricsFrame,
    TextFrame,
    TTSAudioRawFrame,
    TTSStartedFrame,
    UserStoppedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


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
        self._turn_index = 0

    def _now(self) -> float:
        return time.perf_counter()

    def mark_user_speech_end(self, ts: Optional[float] = None) -> None:
        self._user_speech_end_ts = ts if ts is not None else self._now()

    def mark_stt_final(self, ts: Optional[float] = None) -> None:
        self._stt_final_ts = ts if ts is not None else self._now()

    def mark_llm_start(self, ts: Optional[float] = None) -> None:
        self._llm_start_ts = ts if ts is not None else self._now()

    def mark_llm_first_token(self, ts: Optional[float] = None) -> None:
        if self._llm_first_token_ts is None:
            self._llm_first_token_ts = ts if ts is not None else self._now()

    def mark_tts_start(self, ts: Optional[float] = None) -> None:
        if self._tts_start_ts is None:
            self._tts_start_ts = ts if ts is not None else self._now()

    def mark_tts_first_audio(self, ts: Optional[float] = None) -> None:
        if self._tts_first_audio_ts is None:
            self._tts_first_audio_ts = ts if ts is not None else self._now()

    def record_usage(self, input_tokens: int = 0, output_tokens: int = 0, tts_chars: int = 0) -> None:
        self.usage["llm_input_tokens"] += int(input_tokens or 0)
        self.usage["llm_output_tokens"] += int(output_tokens or 0)
        self.usage["tts_chars"] += int(tts_chars or 0)

    def finalize_turn(self) -> Optional[Dict[str, Any]]:
        if self._tts_first_audio_ts is None:
            return None

        def elapsed(start: Optional[float], end: Optional[float]) -> Optional[int]:
            if start is None or end is None:
                return None
            return max(0, round((end - start) * 1000))

        record = {
            "turn_index": self._turn_index,
            "stt_ms": elapsed(self._user_speech_end_ts, self._stt_final_ts),
            "llm_ttfb_ms": elapsed(self._llm_start_ts, self._llm_first_token_ts),
            "tts_ttfb_ms": elapsed(self._tts_start_ts, self._tts_first_audio_ts),
            "voice_to_voice_ms": elapsed(
                self._user_speech_end_ts, self._tts_first_audio_ts
            ),
        }
        self.turn_metrics.append(record)
        self._turn_index += 1
        self._user_speech_end_ts = None
        self._stt_final_ts = None
        self._llm_start_ts = None
        self._llm_first_token_ts = None
        self._tts_start_ts = None
        self._tts_first_audio_ts = None
        return record

    def get_metrics(self) -> List[Dict[str, Any]]:
        return list(self.turn_metrics)

    def get_usage(self) -> Dict[str, int]:
        return dict(self.usage)


class MetricsProcessor(FrameProcessor):
    def __init__(self, collector: MetricsCollector, *, observe_user_turn: bool = False):
        super().__init__()
        self._collector = collector
        self._observe_user_turn = observe_user_turn

    async def process_frame(self, frame: Any, direction: FrameDirection):
        await super().process_frame(frame, direction)

        # UserStoppedSpeakingFrame is emitted by the user turn aggregator.
        # Therefore this processor must sit AFTER user_aggregator to measure
        # actual end-of-speech, not before it.
        if self._observe_user_turn and isinstance(
            frame, (UserStoppedSpeakingFrame, VADUserStoppedSpeakingFrame)
        ):
            self._collector.mark_user_speech_end()

        if isinstance(frame, LLMFullResponseStartFrame):
            self._collector.mark_llm_start()
        elif isinstance(frame, TextFrame) and self._collector._llm_start_ts is not None:
            self._collector.mark_llm_first_token()
        elif isinstance(frame, TTSStartedFrame):
            self._collector.mark_tts_start()
        elif isinstance(frame, TTSAudioRawFrame):
            self._collector.mark_tts_first_audio()
            self._collector.finalize_turn()
        elif isinstance(frame, MetricsFrame):
            for metric in getattr(frame, "data", []) or []:
                processor = str(getattr(metric, "processor", "")).lower()
                if "llm" in processor or "groq" in processor:
                    self._collector.record_usage(
                        input_tokens=getattr(metric, "prompt_tokens", 0) or 0,
                        output_tokens=getattr(metric, "completion_tokens", 0) or 0,
                    )
                elif "tts" in processor or "cartesia" in processor:
                    self._collector.record_usage(
                        tts_chars=getattr(metric, "characters", 0) or 0
                    )

        await self.push_frame(frame, direction)
