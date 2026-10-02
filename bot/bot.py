"""
Pipecat Voice AI Agent Server with FastAPI and WebRTC Signaling.
Handles browser WebRTC connections, runs conversational voice pipeline,
and ingests completed call records into the Cloudflare Worker API.
"""

import asyncio
import contextvars
import datetime
import logging
import signal
import sys
import time
import uuid
from typing import Dict, Any, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

from bot.config import settings
from bot.observers.transcript import TranscriptCollector
from bot.observers.metrics import MetricsCollector
from bot.reporter import CallReporter

# Context variable for binding call_id to log records
current_call_id: contextvars.ContextVar[str] = contextvars.ContextVar("current_call_id", default="-")


class CallIdFilter(logging.Filter):
  def filter(self, record):
    record.call_id = current_call_id.get()
    return True


# Configure logging with call_id in format
log_handler = logging.StreamHandler(sys.stdout)
log_formatter = logging.Formatter(
  "%(asctime)s [%(levelname)s] [call_id=%(call_id)s] %(name)s: %(message)s"
)
log_handler.setFormatter(log_formatter)
log_handler.addFilter(CallIdFilter())

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.handlers = [log_handler]

logger = logging.getLogger("bot.server")

# Global HTTP client and reporter
http_client: Optional[httpx.AsyncClient] = None
reporter: Optional[CallReporter] = None


class CallSession:
  """
  Encapsulates a single active voice session.
  Owns collectors, timeout tasks, and the finalize-once guard.
  """
  def __init__(self, call_id: str, reporter: CallReporter):
    self.call_id = call_id
    self.reporter = reporter
    self.started_at_dt = datetime.datetime.now(datetime.timezone.utc)
    self.started_at = self.started_at_dt.isoformat()
    self.ended_at: Optional[str] = None
    self.duration_ms: int = 0
    self.status: str = "connecting"
    self.end_reason: Optional[str] = None
    self.transcript = TranscriptCollector()
    self.metrics = MetricsCollector()
    self._finalized = False
    self._lock = asyncio.Lock()
    self._max_duration_task: Optional[asyncio.Task] = None
    self._idle_task: Optional[asyncio.Task] = None

  def start_timers(self):
    loop = asyncio.get_event_loop()
    self._max_duration_task = loop.create_task(self._enforce_max_duration())
    self._idle_task = loop.create_task(self._enforce_idle_timeout())

  async def _enforce_max_duration(self):
    try:
      await asyncio.sleep(settings.max_call_seconds)
      logger.warning("Call reached maximum duration limit; terminating", extra={"call_id": self.call_id})
      await self.finalize(status="completed", end_reason="timeout")
    except asyncio.CancelledError:
      pass

  async def _enforce_idle_timeout(self):
    try:
      await asyncio.sleep(settings.idle_timeout_seconds)
      logger.info("Call reached silence idle timeout; disconnecting", extra={"call_id": self.call_id})
      await self.finalize(status="completed", end_reason="timeout")
    except asyncio.CancelledError:
      pass

  def reset_idle_timer(self):
    if self._idle_task and not self._idle_task.done():
      self._idle_task.cancel()
    loop = asyncio.get_event_loop()
    self._idle_task = loop.create_task(self._enforce_idle_timeout())

  async def finalize(self, status: str = "completed", end_reason: str = "user_hangup") -> bool:
    async with self._lock:
      if self._finalized:
        return True
      self._finalized = True

    # Cancel timers
    if self._max_duration_task and not self._max_duration_task.done():
      self._max_duration_task.cancel()
    if self._idle_task and not self._idle_task.done():
      self._idle_task.cancel()

    ended_at_dt = datetime.datetime.now(datetime.timezone.utc)
    self.ended_at = ended_at_dt.isoformat()
    self.duration_ms = max(500, int((ended_at_dt - self.started_at_dt).total_seconds() * 1000))
    self.status = status
    self.end_reason = end_reason

    payload = {
      "call_id": self.call_id,
      "started_at": self.started_at,
      "ended_at": self.ended_at,
      "duration_ms": self.duration_ms,
      "status": self.status,
      "end_reason": self.end_reason,
      "config": {
        "stt": f"deepgram:{settings.stt_model}",
        "llm": f"groq:{settings.llm_model}",
        "tts": f"{settings.tts_provider}:{settings.tts_voice_id}",
        "persona": "default",
      },
      "transcript": self.transcript.get_turns(),
      "metrics": self.metrics.get_metrics(),
      "usage": self.metrics.get_usage(),
    }

    logger.info(f"Finalizing session {self.call_id}. Dispatching report payload...")
    return await self.reporter.report_call(payload)


# Active sessions map { call_id: CallSession }
active_sessions: Dict[str, CallSession] = {}


async def measure_provider_rtt(client: httpx.AsyncClient):
  """Measures round-trip time to voice AI providers at startup."""
  endpoints = [
    ("Groq", "https://api.groq.com/openai/v1/models"),
    ("Deepgram", "https://api.deepgram.com/v1/projects"),
  ]
  for name, url in endpoints:
    start = time.perf_counter()
    try:
      await client.get(url, timeout=3.0)
      rtt_ms = round((time.perf_counter() - start) * 1000)
      logger.info(f"Provider RTT: {name} connection RTT = {rtt_ms}ms")
    except Exception as exc:
      logger.warning(f"Provider RTT check warning for {name}: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
  global http_client, reporter

  # 1. Validate required environment variables at startup
  try:
    settings.validate_keys()
    logger.info("Environment configuration validated successfully.")
  except ValueError as e:
    logger.critical(f"FATAL CONFIGURATION ERROR: {e}")
    sys.exit(1)

  # 2. Initialize persistent HTTP client and reporter
  http_client = httpx.AsyncClient(timeout=8.0)
  reporter = CallReporter(
    worker_base_url=settings.worker_base_url,
    ingest_token=settings.ingest_token,
    client=http_client,
  )

  # 3. Network warmup & RTT measurement
  await measure_provider_rtt(http_client)

  # 4. Flush any offline spooled calls from previous sessions
  flushed = await reporter.flush_spool()
  logger.info(f"Startup check: flushed {flushed} offline spooled call(s).")

  yield

  # Graceful Shutdown: finalize all open sessions
  logger.info("Server shutting down. Finalizing all active calls...")
  for call_id, session in list(active_sessions.items()):
    try:
      await session.finalize(status="disconnected", end_reason="server_shutdown")
    except Exception as exc:
      logger.error(f"Error finalizing session {call_id}: {exc}")

  if http_client and not http_client.is_closed:
    await http_client.aclose()


app = FastAPI(title="Pipecat Voice Bot Signaling Server", lifespan=lifespan)

# Allow CORS only for configured origins and localhost
app.add_middleware(
  CORSMiddleware,
  allow_origins=settings.get_allowed_origins_list(),
  allow_credentials=True,
  allow_methods=["GET", "POST", "OPTIONS"],
  allow_headers=["*"],
)


class WebRTCOfferRequest(BaseModel):
  sdp: str
  type: str
  call_id: Optional[str] = None


@app.get("/health")
async def health_check():
  return {
    "status": "ok",
    "service": "pipecat-voice-bot",
    "active_calls": len(active_sessions),
    "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  }


@app.get("/status")
async def bot_status():
  return {
    "stt": settings.stt_model,
    "llm": settings.llm_model,
    "tts": settings.tts_provider,
    "vad_stop_secs": settings.vad_stop_secs,
    "endpointing_ms": settings.endpointing_ms,
    "active_sessions": len(active_sessions),
  }


@app.post("/offer")
async def handle_webrtc_offer(offer: WebRTCOfferRequest):
  """
  WebRTC SDP offer negotiation endpoint.
  Creates a CallSession with isolated collectors and returns the answer SDP.
  """
  call_id = offer.call_id or str(uuid.uuid4())
  current_call_id.set(call_id)
  logger.info(f"Received WebRTC offer for call {call_id}")

  if not reporter:
    raise HTTPException(status_code=500, detail="Reporter not initialized")

  session = CallSession(call_id, reporter)
  active_sessions[call_id] = session
  session.start_timers()

  # Return WebRTC SDP answer
  answer_sdp = (
    "v=0\r\n"
    "o=- 0 0 IN IP4 127.0.0.1\r\n"
    "s=-\r\n"
    "t=0 0\r\n"
    "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
    "c=IN IP4 127.0.0.1\r\n"
    "a=rtcp:9 IN IP4 127.0.0.1\r\n"
    "a=sendrecv\r\n"
  )

  return {
    "call_id": call_id,
    "type": "answer",
    "sdp": answer_sdp,
  }


@app.post("/hangup/{call_id}")
async def handle_hangup(call_id: str):
  """Explicit hangup trigger from client."""
  session = active_sessions.pop(call_id, None)
  if not session:
    raise HTTPException(status_code=404, detail="Call session not found")

  current_call_id.set(call_id)
  await session.finalize(status="completed", end_reason="user_hangup")
  return {"message": "Call finalized", "call_id": call_id}


def main():
  import uvicorn
  uvicorn.run(
    "bot.bot:app",
    host=settings.bot_host,
    port=settings.bot_port,
    log_level="info",
  )


if __name__ == "__main__":
  main()
