"""
Transcript collection for real Pipecat speech/text frames.
"""

from typing import Any, Dict, List, Optional
import time

try:
    from pipecat.frames.frames import InterruptionFrame, TextFrame, TranscriptionFrame
    from pipecat.processors.frame_processor import FrameProcessor
    PIPECAT_AVAILABLE = True
except ImportError:
    PIPECAT_AVAILABLE = False
    FrameProcessor = object


class TranscriptCollector:
    def __init__(self, start_time: Optional[float] = None):
        self.start_time = start_time or time.time()
        self.turns: List[Dict[str, Any]] = []
        self._current_assistant_turn: Optional[Dict[str, Any]] = None

    def get_elapsed_ms(self) -> int:
        return int((time.time() - self.start_time) * 1000)

    def add_user_turn(self, text: str, ts_ms: Optional[int] = None) -> Dict[str, Any]:
        text = text.strip()
        if not text:
            return {}
        turn = {
            "turn_index": len(self.turns),
            "role": "user",
            "text": text,
            "ts_ms": max(0, self.get_elapsed_ms() if ts_ms is None else ts_ms),
            "interrupted": False,
        }
        self.turns.append(turn)
        return turn

    def start_assistant_turn(self, ts_ms: Optional[int] = None) -> Dict[str, Any]:
        turn = {
            "turn_index": len(self.turns),
            "role": "assistant",
            "text": "",
            "ts_ms": max(0, self.get_elapsed_ms() if ts_ms is None else ts_ms),
            "interrupted": False,
        }
        self._current_assistant_turn = turn
        self.turns.append(turn)
        return turn

    def append_assistant_chunk(self, chunk: str) -> None:
        chunk = chunk.strip()
        if not chunk:
            return
        if self._current_assistant_turn is None:
            self.start_assistant_turn()
        current = self._current_assistant_turn
        current["text"] += chunk if not current["text"] else (" " + chunk)

    def mark_interrupted(self) -> None:
        if self._current_assistant_turn is not None:
            self._current_assistant_turn["interrupted"] = True
            self._current_assistant_turn = None

    def complete_assistant_turn(self) -> None:
        self._current_assistant_turn = None

    def get_turns(self) -> List[Dict[str, Any]]:
        return list(self.turns)


class TranscriptProcessor(FrameProcessor if PIPECAT_AVAILABLE else object):
    def __init__(self, collector: TranscriptCollector):
        if PIPECAT_AVAILABLE:
            super().__init__()
        self._collector = collector

    async def process_frame(self, frame: Any, direction: Any):
        if PIPECAT_AVAILABLE:
            await super().process_frame(frame, direction)
            if isinstance(frame, TranscriptionFrame):
                self._collector.add_user_turn(getattr(frame, "text", ""))
            elif isinstance(frame, InterruptionFrame):
                self._collector.mark_interrupted()
            elif isinstance(frame, TextFrame):
                self._collector.append_assistant_chunk(getattr(frame, "text", ""))
            await self.push_frame(frame, direction)
