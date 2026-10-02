"""
Call Reporter and Local Spool Management.
Handles reliable HTTP delivery of finished call payloads to the Cloudflare Worker API.
Features:
- Idempotent UUID primary keys
- Exponential backoff with jitter on network failures
- Local disk spooling to bot/spool/<call_id>.json if backend unreachable
- Automatic startup spool replay and CLI flush (--flush)
- Single-execution finalize() guarantee
"""

import asyncio
import json
import logging
import os
import random
from pathlib import Path
from typing import Dict, Any, Optional

try:
  import httpx
  HAS_HTTPX = True
except ImportError:
  import urllib.request
  import urllib.error
  HAS_HTTPX = False

logger = logging.getLogger("bot.reporter")
SPOOL_DIR = Path(__file__).resolve().parent / "spool"


class CallReporter:
  def __init__(self, worker_base_url: str, ingest_token: str):
    self.worker_base_url = worker_base_url.rstrip("/")
    self.ingest_token = ingest_token
    self._finalized = False
    self._lock = asyncio.Lock()
    SPOOL_DIR.mkdir(parents=True, exist_ok=True)

  async def finalize_and_report(self, payload: Dict[str, Any]) -> bool:
    """
    Guarantees exactly-once reporting per call session.
    Returns True if successfully ingested or spooled safely.
    """
    async with self._lock:
      if self._finalized:
        logger.info("Call already finalized; skipping redundant report", extra={"call_id": payload.get("call_id")})
        return True
      self._finalized = True

    return await self.send_with_retry_and_spool(payload)

  async def _post_json(self, url: str, payload: Dict[str, Any], headers: Dict[str, str]) -> int:
    """Internal helper sending JSON via httpx or urllib."""
    if HAS_HTTPX:
      async with httpx.AsyncClient(timeout=5.0) as client:
        res = await client.post(url, json=payload, headers=headers)
        return res.status_code
    else:
      def sync_post():
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
          with urllib.request.urlopen(req, timeout=5.0) as res:
            return res.getcode()
        except urllib.error.HTTPError as e:
          return e.code
      return await asyncio.to_thread(sync_post)

  async def send_with_retry_and_spool(self, payload: Dict[str, Any], max_attempts: int = 3) -> bool:
    call_id = payload.get("call_id", "unknown")
    url = f"{self.worker_base_url}/calls"
    headers = {
      "Authorization": f"Bearer {self.ingest_token}",
      "Content-Type": "application/json",
      "X-Request-ID": f"bot_rep_{call_id}",
    }

    # Attempt HTTP POST with exponential backoff & jitter
    for attempt in range(1, max_attempts + 1):
      try:
        status_code = await self._post_json(url, payload, headers)
        if 200 <= status_code < 300:
          logger.info("Successfully reported call to Worker", extra={"call_id": call_id, "status": status_code})
          return True
        elif status_code in (400, 401):
          logger.error("Worker rejected payload", extra={"call_id": call_id, "status": status_code})
          break
        else:
          logger.warning("Worker returned transient status, retrying", extra={"call_id": call_id, "attempt": attempt, "status": status_code})
      except Exception as exc:
        logger.warning("Network error reaching Worker API", extra={"call_id": call_id, "attempt": attempt, "error": str(exc)})

      if attempt < max_attempts:
        backoff = (2 ** (attempt - 1)) + random.uniform(0.1, 0.5)
        await asyncio.sleep(backoff)

    # All attempts failed -> Fallback to local spool file
    logger.warning("Failed all POST attempts; writing payload to local spool", extra={"call_id": call_id})
    return self.spool_payload(call_id, payload)

  def spool_payload(self, call_id: str, payload: Dict[str, Any]) -> bool:
    """Writes payload to disk so it is never lost during backend outages."""
    try:
      spool_file = SPOOL_DIR / f"{call_id}.json"
      with open(spool_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
      logger.info("Spooled call payload to disk successfully", extra={"path": str(spool_file)})
      return True
    except Exception as exc:
      logger.critical("Fatal: could not spool call payload to disk", extra={"call_id": call_id, "error": str(exc)})
      return False

  async def flush_spool(self) -> int:
    """
    Replays all spooled calls to the Worker.
    Removes files only after verified 2xx response.
    Returns the count of successfully flushed calls.
    """
    spool_files = list(SPOOL_DIR.glob("*.json"))
    if not spool_files:
      return 0

    logger.info("Flushing spooled call files", extra={"count": len(spool_files)})
    flushed = 0

    for file_path in spool_files:
      try:
        with open(file_path, "r", encoding="utf-8") as f:
          payload = json.load(f)

        call_id = payload.get("call_id")
        url = f"{self.worker_base_url}/calls"
        headers = {
          "Authorization": f"Bearer {self.ingest_token}",
          "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=5.0) as client:
          response = await client.post(url, json=payload, headers=headers)
          if 200 <= response.status_code < 300:
            logger.info("Successfully flushed spooled call; removing file", extra={"call_id": call_id})
            file_path.unlink(missing_ok=True)
            flushed += 1
          else:
            logger.warning("Failed to flush spooled call", extra={"call_id": call_id, "status": response.status_code})
      except Exception as exc:
        logger.error("Error reading or sending spooled file", extra={"file": file_path.name, "error": str(exc)})

    return flushed


if __name__ == "__main__":
  import sys
  from bot.config import settings

  logging.basicConfig(level=logging.INFO)
  if "--flush" in sys.argv:
    reporter = CallReporter(settings.worker_base_url, settings.ingest_token)
    count = asyncio.run(reporter.flush_spool())
    print(f"Flushed {count} spooled call(s).")
