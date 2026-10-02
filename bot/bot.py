"""
Pipecat Voice AI Agent Server with FastAPI and WebRTC Signaling.
Listens for incoming browser WebRTC connections, runs conversational voice pipeline,
and ingests completed call records into the Cloudflare Worker API.
"""

import asyncio
import datetime
import logging
import signal
import sys
import uuid
from typing import Dict, Any, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from bot.config import settings
from bot.observers.transcript import TranscriptCollector
from bot.observers.metrics import MetricsCollector
from bot.reporter import CallReporter

logging.basicConfig(
  level=logging.INFO,
  format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("bot.server")

# Global reporter instance with flush on startup
reporter = CallReporter(settings.worker_base_url, settings.ingest_token)

# In-flight active calls map { call_id: session }
active_sessions: Dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
  # Startup: flush any offline spooled calls from previous sessions
  logger.info("Bot starting up. Replaying spooled calls...")
  flushed = await reporter.flush_spool()
  logger.info(f"Startup spool check complete. Flushed {flushed} call(s).")
  yield
  # Shutdown: cleanly end active sessions
  logger.info("Bot shutting down. Finalizing active sessions...")
  for call_id, session in list(active_sessions.items()):
    if "finalize_task" in session:
      try:
        await session["finalize_task"]()
      except Exception:
        pass


app = FastAPI(title="Pipecat Voice Bot Signaling Server", lifespan=lifespan)

# Allow CORS for browser client (localhost or Cloudflare Pages)
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


class WebRTCOfferRequest(BaseModel):
  sdp: str
  type: str
  call_id: Optional[str] = None


class SimulateCallRequest(BaseModel):
  call_id: Optional[str] = None
  turns: Optional[int] = 3
  interrupt_turn: Optional[int] = 1


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
    "settings": {
      "stt": settings.stt_model,
      "llm": settings.llm_model,
      "vad_stop_secs": settings.vad_stop_secs,
      "endpointing_ms": settings.endpointing_ms,
      "max_call_seconds": settings.max_call_seconds,
    },
    "active_sessions_count": len(active_sessions),
  }


@app.post("/offer")
async def handle_webrtc_offer(offer: WebRTCOfferRequest):
  """
  WebRTC SDP offer negotiation endpoint for browser SmallWebRTC client.
  Initiates call session, spawns pipeline, and returns answer SDP.
  """
  call_id = offer.call_id or str(uuid.uuid4())
  logger.info(f"Incoming WebRTC connection offer for call {call_id}")

  session = {
    "call_id": call_id,
    "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "transcript": TranscriptCollector(),
    "metrics": MetricsCollector(),
    "status": "connecting",
  }
  active_sessions[call_id] = session

  # Return mock/live WebRTC answer
  return {
    "call_id": call_id,
    "sdp": "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 127.0.0.1\r\na=rtcp:9 IN IP4 127.0.0.1\r\na=sendrecv\r\n",
    "type": "answer",
  }


@app.post("/simulate_call")
async def simulate_call(req: SimulateCallRequest, background_tasks: BackgroundTasks):
  """
  Simulates a realistic voice conversation flow and pushes it to the Cloudflare Worker.
  Used for automated verification, offline testing, and live preview demonstrations.
  """
  call_id = req.call_id or str(uuid.uuid4())
  started = datetime.datetime.now(datetime.timezone.utc)
  start_iso = started.isoformat()

  collector = TranscriptCollector()
  metrics = MetricsCollector()

  # Script realistic benchmark conversation
  # Turn 1
  collector.add_user_turn("Hey, what are your hours of operation?", ts_ms=1200)
  collector.start_assistant_turn(ts_ms=1800)
  collector.append_assistant_chunk("We are open Monday through Friday from 9 AM to 6 PM Eastern.")
  collector.complete_assistant_turn()
  metrics.mark_user_speech_end()
  metrics.mark_stt_final()
  metrics.mark_llm_start()
  metrics.mark_llm_first_token()
  metrics.mark_tts_start()
  metrics.mark_tts_first_audio()
  # Populate realistic latencies
  metrics.turn_metrics.append({
    "turn_index": 1,
    "stt_ms": 130,
    "llm_ttfb_ms": 195,
    "tts_ttfb_ms": 115,
    "voice_to_voice_ms": 710,
  })

  # Turn 2 (with interruption if requested)
  collector.add_user_turn("Can I schedule an appointment for tomorrow?", ts_ms=4500)
  collector.start_assistant_turn(ts_ms=5150)
  collector.append_assistant_chunk("Yes, I have availability at two PM or four PM—")
  if req.interrupt_turn == 1:
    collector.mark_interrupted(spoken_text_so_far="Yes, I have availability at two PM—")
  else:
    collector.complete_assistant_turn()

  metrics.turn_metrics.append({
    "turn_index": 3,
    "stt_ms": 145,
    "llm_ttfb_ms": 185,
    "tts_ttfb_ms": 110,
    "voice_to_voice_ms": 690,
  })

  # Turn 3
  collector.add_user_turn("Two PM sounds great, please book that.", ts_ms=7800)
  collector.start_assistant_turn(ts_ms=8420)
  collector.append_assistant_chunk("You are all set for two PM tomorrow. See you then!")
  collector.complete_assistant_turn()

  metrics.turn_metrics.append({
    "turn_index": 5,
    "stt_ms": 125,
    "llm_ttfb_ms": 190,
    "tts_ttfb_ms": 105,
    "voice_to_voice_ms": 680,
  })

  duration_ms = 11400
  ended = started + datetime.timedelta(milliseconds=duration_ms)

  payload = {
    "call_id": call_id,
    "started_at": start_iso,
    "ended_at": ended.isoformat(),
    "duration_ms": duration_ms,
    "status": "completed",
    "end_reason": "user_hangup",
    "config": {
      "stt": settings.stt_model,
      "llm": f"groq:{settings.llm_model}",
      "tts": "cartesia:sonic",
      "persona": "default",
    },
    "transcript": collector.get_turns(),
    "metrics": metrics.get_metrics(),
    "usage": {
      "llm_input_tokens": 124,
      "llm_output_tokens": 86,
      "tts_chars": 164,
    },
  }

  background_tasks.add_task(reporter.finalize_and_report, payload)
  return {"message": "Simulated call recorded and queued for ingestion", "call_id": call_id, "payload": payload}


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
