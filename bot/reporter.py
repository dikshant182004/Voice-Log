"""
Call Reporter and Local Spool Management.
Handles reliable HTTP delivery of finished call payloads to the Cloudflare Worker API.

Key Invariants:
- Multiple calls per session: finalize-once is tracked per call_id (or on CallSession)
- Reuses a persistent httpx.AsyncClient
- Exponential backoff with jitter on network errors and transient HTTP status (408, 429, 5xx)
- No retry on client errors (400, 401, 413, 422): stored to bot/spool/rejected/
- Atomic spool writes (write to .tmp then os.replace)
- Pydantic payload validation before transmission
"""

import asyncio
import json
import logging
import os
import random
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, Set, List

try:
  from pydantic import BaseModel, Field
except ImportError:
  class BaseModel:
    def __init__(self, **kwargs):
      for k, v in kwargs.items():
        setattr(self, k, v)
    def model_dump(self):
      return self.__dict__
  def Field(*args, **kwargs):
    if 'default_factory' in kwargs:
      return kwargs['default_factory']()
    return kwargs.get('default', None)

try:
  import httpx
except ImportError:
  httpx = None

logger = logging.getLogger("bot.reporter")
SPOOL_DIR = Path(__file__).resolve().parent / "spool"
REJECTED_DIR = SPOOL_DIR / "rejected"


class TranscriptTurnModel(BaseModel):
  turn_index: int = Field(ge=0)
  role: str
  text: str = Field(max_length=4000)
  ts_ms: int = Field(ge=0, default=0)
  interrupted: bool = False


class TurnMetricModel(BaseModel):
  turn_index: int = Field(ge=0)
  stt_ms: Optional[int] = None
  llm_ttfb_ms: Optional[int] = None
  tts_ttfb_ms: Optional[int] = None
  voice_to_voice_ms: Optional[int] = None


class CallConfigModel(BaseModel):
  stt: str = "deepgram:nova-3-general"
  llm: str = "groq:openai/gpt-oss-20b"
  tts: str = "cartesia:sonic-3.6"
  persona: str = "default"


class CallUsageModel(BaseModel):
  llm_input_tokens: int = 0
  llm_output_tokens: int = 0
  tts_chars: int = 0


class IngestCallPayloadModel(BaseModel):
  call_id: str
  started_at: str
  ended_at: str
  duration_ms: int = Field(ge=0)
  status: str
  end_reason: Optional[str] = None
  config: CallConfigModel = Field(default_factory=CallConfigModel)
  transcript: List[TranscriptTurnModel] = Field(default_factory=list)
  metrics: List[TurnMetricModel] = Field(default_factory=list)
  usage: CallUsageModel = Field(default_factory=CallUsageModel)


class CallReporter:
  def __init__(self, worker_base_url: str, ingest_token: str, client: Optional[Any] = None):
    self.worker_base_url = worker_base_url.rstrip("/")
    self.ingest_token = ingest_token
    self._client = client
    self._finalized = False
    self._finalized_call_ids: Set[str] = set()
    self._lock = asyncio.Lock()
    SPOOL_DIR.mkdir(parents=True, exist_ok=True)
    REJECTED_DIR.mkdir(parents=True, exist_ok=True)

  def set_client(self, client: Any) -> None:
    self._client = client

  async def finalize_call(self, call_id: str) -> bool:
    """
    Returns True if this is the first finalization for this call_id,
    False if already finalized.
    """
    async with self._lock:
      if call_id in self._finalized_call_ids:
        return False
      self._finalized_call_ids.add(call_id)
      return True

  async def finalize_and_report(self, payload: Dict[str, Any]) -> bool:
    """Finalizes once and reports the payload. If already finalized, returns True without duplicate send."""
    call_id = payload.get("call_id", "unknown")
    if not await self.finalize_call(call_id):
      return True
    return await self.report_call(payload)

  def validate_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Validates raw dictionary against Pydantic contract before sending."""
    model = IngestCallPayloadModel(**payload)
    return model.model_dump()

  async def report_call(self, payload: Dict[str, Any], max_attempts: int = 3) -> bool:
    call_id = payload.get("call_id", "unknown")

    # Validate before attempting send
    try:
      validated = self.validate_payload(payload)
    except Exception as exc:
      logger.error(f"Payload validation failed for call {call_id}: {exc}", extra={"call_id": call_id})
      self._atomic_spool(call_id, payload, REJECTED_DIR)
      return False

    url = f"{self.worker_base_url}/calls"
    headers = {
      "Authorization": f"Bearer {self.ingest_token}",
      "Content-Type": "application/json",
      "X-Request-ID": f"rep_{call_id}",
    }

    # Attempt send with exponential backoff & jitter
    for attempt in range(1, max_attempts + 1):
      try:
        if self._client and not self._client.is_closed:
          response = await self._client.post(url, json=validated, headers=headers)
        else:
          async with httpx.AsyncClient(timeout=5.0) as temp_client:
            response = await temp_client.post(url, json=validated, headers=headers)

        # 2xx Success (including idempotent duplicate 200)
        if 200 <= response.status_code < 300:
          logger.info(f"Reported call {call_id} successfully (status={response.status_code})", extra={"call_id": call_id})
          return True

        # Non-retriable client errors: move to rejected/
        if response.status_code in (400, 401, 413, 422):
          logger.error(
            f"Worker rejected call {call_id} (HTTP {response.status_code}): {response.text}",
            extra={"call_id": call_id}
          )
          self._atomic_spool(call_id, validated, REJECTED_DIR)
          return False

        # Retriable server error or rate limit (408, 429, 5xx)
        logger.warning(
          f"Transient status {response.status_code} for call {call_id} (attempt {attempt}/{max_attempts})",
          extra={"call_id": call_id}
        )

      except (httpx.RequestError, httpx.TimeoutException) as exc:
        logger.warning(
          f"Network error reporting call {call_id} (attempt {attempt}/{max_attempts}): {exc}",
          extra={"call_id": call_id}
        )

      if attempt < max_attempts:
        backoff = (2 ** (attempt - 1)) + random.uniform(0.1, 0.4)
        await asyncio.sleep(backoff)

    # Exhausted retries -> Spool to disk
    logger.warning(f"Exhausted retries for call {call_id}. Spooling to disk.", extra={"call_id": call_id})
    self.spool_payload(call_id, validated)
    return False

  def _atomic_spool(self, call_id: str, payload: Dict[str, Any], target_dir: Path) -> bool:
    """Atomically writes payload to a temporary file then replaces target."""
    try:
      target_dir.mkdir(parents=True, exist_ok=True)
      final_path = target_dir / f"{call_id}.json"

      with tempfile.NamedTemporaryFile("w", dir=target_dir, delete=False, encoding="utf-8") as tf:
        json.dump(payload, tf, indent=2)
        temp_name = tf.name

      os.replace(temp_name, final_path)
      return True
    except Exception as exc:
      logger.critical(f"Failed to spool payload for call {call_id}: {exc}", extra={"call_id": call_id})
      return False

  def spool_payload(self, call_id: str, payload: Dict[str, Any]) -> bool:
    return self._atomic_spool(call_id, payload, SPOOL_DIR)

  async def flush_spool(self) -> int:
    """
    Replays all spooled call files in bot/spool/ to Worker API.
    Deletes only files that receive 2xx response.
    """
    spool_files = [f for f in SPOOL_DIR.glob("*.json") if f.is_file()]
    if not spool_files:
      return 0

    logger.info(f"Replaying {len(spool_files)} spooled call(s)...")
    flushed_count = 0

    for file_path in spool_files:
      try:
        with open(file_path, "r", encoding="utf-8") as f:
          payload = json.load(f)

        call_id = payload.get("call_id")
        url = f"{self.worker_base_url}/calls"
        headers = {
          "Authorization": f"Bearer {self.ingest_token}",
          "Content-Type": "application/json",
          "X-Request-ID": f"flush_{call_id}",
        }

        if self._client and not self._client.is_closed:
          response = await self._client.post(url, json=payload, headers=headers)
        else:
          async with httpx.AsyncClient(timeout=5.0) as temp_client:
            response = await temp_client.post(url, json=payload, headers=headers)

        if 200 <= response.status_code < 300:
          logger.info(f"Successfully flushed spooled call {call_id}; removing file.")
          file_path.unlink(missing_ok=True)
          flushed_count += 1
        elif response.status_code in (400, 401, 413, 422):
          logger.error(f"Permanent rejection on flush for {call_id} ({response.status_code}); moving to rejected/")
          self._atomic_spool(call_id, payload, REJECTED_DIR)
          file_path.unlink(missing_ok=True)
        else:
          logger.warning(f"Failed transient flush for {call_id} (status={response.status_code}); keeping file.")
      except Exception as exc:
        logger.error(f"Error processing spooled file {file_path.name}: {exc}")

    return flushed_count
