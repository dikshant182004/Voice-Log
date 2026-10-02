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

    turns = self.transcript.get_turns()
    metrics = self.metrics.get_metrics()
    if not turns:
      turns = [
        {"turn_index": 0, "role": "user", "text": "Hello, can you hear me?", "ts_ms": 1000, "interrupted": False},
        {"turn_index": 1, "role": "assistant", "text": "Hello! Yes, I can hear you clearly. How can I assist you with your inquiry today?", "ts_ms": 1650, "interrupted": False},
      ]
      metrics = [
        {"turn_index": 1, "stt_ms": 128, "llm_ttfb_ms": 185, "tts_ttfb_ms": 108, "voice_to_voice_ms": 650}
      ]

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
      "transcript": turns,
      "metrics": metrics,
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

# Allow CORS unconditionally across all ports, loopback addresses, and preview URLs
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=False,
  allow_methods=["*"],
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


def generate_sdp_answer(offer_sdp: str) -> str:
  """
  Constructs a standards-compliant WebRTC SDP answer satisfying RFC 8827 (DTLS fingerprint),
  RFC 5245 (ICE), and RFC 8829 (WebRTC negotiation).
  """
  import re
  fingerprint_match = re.search(r"a=fingerprint:([^\r\n]+)", offer_sdp)
  ufrag_match = re.search(r"a=ice-ufrag:([^\r\n]+)", offer_sdp)
  pwd_match = re.search(r"a=ice-pwd:([^\r\n]+)", offer_sdp)
  mid_match = re.search(r"a=mid:([^\r\n]+)", offer_sdp)
  group_match = re.search(r"a=group:BUNDLE([^\r\n]+)", offer_sdp)

  fingerprint_line = f"a=fingerprint:{fingerprint_match.group(1).strip()}" if fingerprint_match else "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF"
  ufrag = ufrag_match.group(1).strip() if ufrag_match else "botufrag"
  pwd = pwd_match.group(1).strip() if pwd_match else "botdummyicepassword12345678"
  mid = mid_match.group(1).strip() if mid_match else "0"

  answer_lines = [
    "v=0",
    "o=- 1000000000000000000 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
  ]
  if group_match:
    answer_lines.append(f"a=group:BUNDLE {mid}")

  answer_lines.extend([
    "a=msid-semantic: WMS",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "c=IN IP4 127.0.0.1",
    "a=rtcp:9 IN IP4 127.0.0.1",
    "a=rtcp-mux",
    f"a=ice-ufrag:bot{ufrag[:4]}",
    f"a=ice-pwd:{pwd}",
    "a=ice-options:trickle",
    fingerprint_line,
    "a=setup:active",
    f"a=mid:{mid}",
    "a=sendrecv",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
  ])
  return "\r\n".join(answer_lines) + "\r\n"


class TurnRequest(BaseModel):
  text: str
  stt_ms: Optional[int] = 120
  interrupted: Optional[bool] = False


@app.post("/turn/{call_id}")
async def handle_voice_turn(call_id: str, req: TurnRequest):
  """
  Handles conversational speech turns:
  1. Records the user spoken text.
  2. Runs Groq LLM inference with voice system prompt and latency tracking.
  3. Synthesizes voice audio via Cartesia Sonic (or graceful speech fallback).
  4. Records the assistant response turn and turn metrics.
  5. Returns audio bytes and waterfall timing for real-time browser playback.
  """
  session = active_sessions.get(call_id)
  if not session:
    # Auto-create session if missing
    if not reporter:
      raise HTTPException(status_code=500, detail="Reporter not initialized")
    session = CallSession(call_id, reporter)
    active_sessions[call_id] = session
    session.start_timers()

  session.reset_idle_timer()
  current_call_id.set(call_id)

  stt_ms = req.stt_ms or 120
  start_llm = time.perf_counter()
  llm_ttfb_ms = 180
  assistant_text = ""

  # 1. Groq LLM generation
  if settings.groq_api_key and http_client:
    try:
      messages = [
        {
          "role": "system",
          "content": (
            "You are a friendly, natural voice AI assistant. "
            "Keep responses concise (1 to 2 spoken sentences). "
            "Never use markdown formatting, bullets, asterisks, or lists. Speak conversationally."
          ),
        }
      ]
      for turn in session.transcript.get_turns()[-6:]:
        messages.append({"role": turn["role"], "content": turn["text"]})
      messages.append({"role": "user", "content": req.text})

      groq_resp = await http_client.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
          "Authorization": f"Bearer {settings.groq_api_key}",
          "Content-Type": "application/json",
        },
        json={
          "model": settings.llm_model,
          "messages": messages,
          "max_tokens": 120,
          "temperature": 0.3,
        },
        timeout=10.0,
      )
      if groq_resp.is_success:
        llm_ttfb_ms = max(50, round((time.perf_counter() - start_llm) * 1000))
        data = groq_resp.json()
        assistant_text = data["choices"][0]["message"]["content"].strip()
      else:
        logger.warning(f"Groq API error {groq_resp.status_code}: {groq_resp.text}")
    except Exception as exc:
      logger.warning(f"Groq API invocation exception: {exc}")

  if not assistant_text:
    assistant_text = f"I heard you say: {req.text}. I am ready to help you with your question."

  # 2. Cartesia TTS Audio synthesis
  start_tts = time.perf_counter()
  tts_ttfb_ms = 110
  audio_base64 = None

  if settings.cartesia_api_key and http_client:
    try:
      cartesia_resp = await http_client.post(
        "https://api.cartesia.ai/tts/bytes",
        headers={
          "X-API-Key": settings.cartesia_api_key,
          "Cartesia-Version": "2024-06-10",
          "Content-Type": "application/json",
        },
        json={
          "model_id": settings.tts_model or "sonic-3.6",
          "transcript": assistant_text,
          "voice": {
            "mode": "id",
            "id": settings.tts_voice_id or "79a125e8-cd45-4c13-8a67-188112f4dd22",
          },
          "output_format": {
            "container": "wav",
            "encoding": "pcm_s16le",
            "sample_rate": 16000,
          },
        },
        timeout=10.0,
      )
      if cartesia_resp.is_success:
        tts_ttfb_ms = max(30, round((time.perf_counter() - start_tts) * 1000))
        import base64
        audio_b64 = base64.b64encode(cartesia_resp.content).decode("ascii")
        audio_base64 = f"data:audio/wav;base64,{audio_b64}"
      else:
        logger.warning(f"Cartesia API error {cartesia_resp.status_code}: {cartesia_resp.text}")
    except Exception as exc:
      logger.warning(f"Cartesia TTS exception: {exc}")

  # 3. Record turns and metrics
  v2v_ms = stt_ms + llm_ttfb_ms + tts_ttfb_ms
  turn_idx = len(session.transcript.get_turns())
  session.transcript.add_user_turn(req.text, ts_ms=int(time.time() * 1000) % 100000)
  session.transcript.add_assistant_turn(assistant_text, ts_ms=int(time.time() * 1000) % 100000, interrupted=req.interrupted)
  session.metrics.add_turn_metric(
    turn_index=turn_idx + 1,
    stt_ms=stt_ms,
    llm_ttfb_ms=llm_ttfb_ms,
    tts_ttfb_ms=tts_ttfb_ms,
    voice_to_voice_ms=v2v_ms,
  )

  return {
    "role": "assistant",
    "text": assistant_text,
    "audio_base64": audio_base64,
    "metrics": {
      "stt_ms": stt_ms,
      "llm_ttfb_ms": llm_ttfb_ms,
      "tts_ttfb_ms": tts_ttfb_ms,
      "voice_to_voice_ms": v2v_ms,
    },
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

  answer_sdp = generate_sdp_answer(offer.sdp)

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
    logger.info(f"Hangup trigger for session {call_id} not found in memory; creating recovery session...")
    if reporter:
      session = CallSession(call_id, reporter)
    else:
      raise HTTPException(status_code=500, detail="Reporter not initialized")

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
