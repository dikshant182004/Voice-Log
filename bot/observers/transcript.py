"""
In-memory transcript collector and turn manager.
Tracks user and assistant turns with millisecond offsets and interruption detection.
"""

from typing import List, Dict, Any, Optional
import time


class TranscriptCollector:
  def __init__(self, start_time: Optional[float] = None):
    self.start_time = start_time or time.time()
    self.turns: List[Dict[str, Any]] = []
    self._current_assistant_turn: Optional[Dict[str, Any]] = None

  def get_elapsed_ms(self) -> int:
    return int((time.time() - self.start_time) * 1000)

  def add_user_turn(self, text: str, ts_ms: Optional[int] = None) -> Dict[str, Any]:
    """Records a completed user utterance."""
    if ts_ms is None:
      ts_ms = self.get_elapsed_ms()
    turn = {
      "turn_index": len(self.turns),
      "role": "user",
      "text": text.strip(),
      "ts_ms": max(0, ts_ms),
      "interrupted": False,
    }
    self.turns.append(turn)
    return turn

  def add_assistant_turn(
    self,
    text: str,
    ts_ms: Optional[int] = None,
    interrupted: bool = False,
  ) -> Dict[str, Any]:
    """Directly records a completed assistant utterance turn."""
    if ts_ms is None:
      ts_ms = self.get_elapsed_ms()
    turn = {
      "turn_index": len(self.turns),
      "role": "assistant",
      "text": text.strip(),
      "ts_ms": max(0, ts_ms),
      "interrupted": interrupted,
    }
    self.turns.append(turn)
    return turn

  def start_assistant_turn(self, ts_ms: Optional[int] = None) -> Dict[str, Any]:
    """Begins accumulating a new assistant turn."""
    if ts_ms is None:
      ts_ms = self.get_elapsed_ms()
    turn = {
      "turn_index": len(self.turns),
      "role": "assistant",
      "text": "",
      "ts_ms": max(0, ts_ms),
      "interrupted": False,
    }
    self._current_assistant_turn = turn
    self.turns.append(turn)
    return turn

  def append_assistant_chunk(self, chunk: str) -> None:
    """Appends synthesized/spoken audio text chunk to current turn."""
    if self._current_assistant_turn is not None:
      if self._current_assistant_turn["text"]:
        self._current_assistant_turn["text"] += " " + chunk.strip()
      else:
        self._current_assistant_turn["text"] = chunk.strip()

  def mark_interrupted(self, spoken_text_so_far: Optional[str] = None) -> None:
    """
    Called when user interrupts bot speech.
    Marks the current assistant turn as interrupted and trims text to what was actually spoken.
    """
    if self._current_assistant_turn is not None:
      self._current_assistant_turn["interrupted"] = True
      if spoken_text_so_far is not None:
        self._current_assistant_turn["text"] = spoken_text_so_far.strip()
      self._current_assistant_turn = None

  def complete_assistant_turn(self, final_text: Optional[str] = None) -> None:
    """Finalizes normal completion of assistant turn."""
    if self._current_assistant_turn is not None:
      if final_text is not None:
        self._current_assistant_turn["text"] = final_text.strip()
      self._current_assistant_turn = None

  def get_turns(self) -> List[Dict[str, Any]]:
    return list(self.turns)
