"""
FastAPI host for the Pipecat 1.12.0 SmallWebRTC voice bot.

The Worker only receives finalized call data. WebRTC/audio processing stays
inside the Pipecat bot process.
"""

import asyncio
import contextvars
import datetime
import logging
import sys
import uuid
from contextlib import asynccontextmanager
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from bot.config import settings
from bot.observers.metrics import MetricsCollector
from bot.observers.transcript import TranscriptCollector
from bot.pipeline import create_pipeline
from bot.reporter import CallReporter

from pipecat.workers.runner import WorkerRunner
from pipecat.transports.smallwebrtc.request_handler import (
    IceCandidate,
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)

current_call_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "current_call_id", default="-"
)


class CallIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.call_id = current_call_id.get()
        return True


handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(
    logging.Formatter(
        "%(asctime)s [%(levelname)s] [call_id=%(call_id)s] "
        "%(name)s: %(message)s"
    )
)
handler.addFilter(CallIdFilter())

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.handlers = [handler]
logger = logging.getLogger("bot.server")

http_client: Optional[httpx.AsyncClient] = None
reporter: Optional[CallReporter] = None
webrtc_handler = SmallWebRTCRequestHandler()


class CallSession:
    def __init__(self, call_id: str, reporter_instance: CallReporter):
        self.call_id = call_id
        self.reporter = reporter_instance
        self.started_at_dt = datetime.datetime.now(datetime.timezone.utc)
        self.started_at = self.started_at_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        self.ended_at: Optional[str] = None
        self.duration_ms = 0
        self.status = "connecting"
        self.end_reason: Optional[str] = None

        self.transcript = TranscriptCollector(
            start_time=self.started_at_dt.timestamp()
        )
        self.metrics = MetricsCollector()

        self.runner: Optional[WorkerRunner] = None
        self.runner_task: Optional[asyncio.Task] = None
        self._finalized = False
        self._lock = asyncio.Lock()
        self._max_duration_task: Optional[asyncio.Task] = None

    def start_timer(self) -> None:
        self._max_duration_task = asyncio.create_task(self._enforce_max_duration())

    async def _enforce_max_duration(self) -> None:
        try:
            await asyncio.sleep(settings.max_call_seconds)
            await self.request_stop("timeout")
        except asyncio.CancelledError:
            pass

    async def request_stop(self, reason: str) -> None:
        self.end_reason = reason
        if self.runner is not None:
            try:
                await self.runner.cancel(reason=reason)
            except Exception as exc:
                logger.warning(
                    "Failed to cancel runner for %s: %s", self.call_id, exc
                )

    async def finalize(
        self,
        status: str = "completed",
        end_reason: str = "user_hangup",
    ) -> bool:
        async with self._lock:
            if self._finalized:
                return True
            self._finalized = True

        if self._max_duration_task and not self._max_duration_task.done():
            self._max_duration_task.cancel()

        ended_at_dt = datetime.datetime.now(datetime.timezone.utc)
        self.ended_at = ended_at_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        self.duration_ms = max(
            0,
            round((ended_at_dt - self.started_at_dt).total_seconds() * 1000),
        )
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
                "tts": f"{settings.tts_provider}:{settings.tts_model}",
                "persona": "default",
            },
            "transcript": self.transcript.get_turns(),
            "metrics": self.metrics.get_metrics(),
            "usage": self.metrics.get_usage(),
        }

        current_call_id.set(self.call_id)
        logger.info(
            "Finalizing call: transcript=%d turns, metrics=%d records",
            len(payload["transcript"]),
            len(payload["metrics"]),
        )
        return await self.reporter.report_call(payload)


active_sessions: dict[str, CallSession] = {}


async def measure_provider_rtt(client: httpx.AsyncClient) -> None:
    for name, url in (
        ("Groq", "https://api.groq.com/openai/v1/models"),
        ("Deepgram", "https://api.deepgram.com/v1/projects"),
    ):
        try:
            started = asyncio.get_running_loop().time()
            await client.get(url, timeout=3.0)
            elapsed = round(
                (asyncio.get_running_loop().time() - started) * 1000
            )
            logger.info("Provider RTT: %s=%sms", name, elapsed)
        except Exception as exc:
            logger.warning("Provider RTT check failed for %s: %s", name, exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client, reporter

    settings.validate_keys()

    http_client = httpx.AsyncClient(timeout=8.0)
    reporter = CallReporter(
        worker_base_url=settings.worker_base_url,
        ingest_token=settings.ingest_token,
        client=http_client,
    )

    await measure_provider_rtt(http_client)
    flushed = await reporter.flush_spool()
    logger.info("Flushed %d spooled call(s)", flushed)

    yield

    for session in list(active_sessions.values()):
        try:
            await session.request_stop("server_shutdown")
            await session.finalize(
                status="disconnected",
                end_reason="client_disconnect",
            )
        except Exception as exc:
            logger.error(
                "Error finalizing call %s: %s", session.call_id, exc
            )

    await webrtc_handler.close()

    if http_client and not http_client.is_closed:
        await http_client.aclose()


app = FastAPI(title="Pipecat Voice Bot", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins_list(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


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


async def _run_session(
    session: CallSession,
    connection: Any,
) -> None:
    transport = None
    try:
        from pipecat.transports.base_transport import TransportParams

        transport = __import__(
            "pipecat.transports.smallwebrtc.transport",
            fromlist=["SmallWebRTCTransport"],
        ).SmallWebRTCTransport(
            webrtc_connection=connection,
            params=TransportParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                audio_in_sample_rate=16000,
                audio_out_sample_rate=settings.tts_sample_rate,
                audio_in_passthrough=False,
            ),
        )

        _, worker = create_pipeline(
            settings,
            session.transcript,
            session.metrics,
            transport,
        )
        session.runner = WorkerRunner(
            handle_sigint=False,
            handle_sigterm=False,
        )
        await session.runner.add_workers(worker)

        @worker.event_handler("on_pipeline_finished")
        async def on_pipeline_finished(worker_instance: Any, frame: Any):
            reason = session.end_reason or "client_disconnect"
            await session.finalize(
                status="disconnected" if reason == "client_disconnect" else "completed",
                end_reason=reason,
            )
            active_sessions.pop(session.call_id, None)

        @worker.event_handler("on_pipeline_error")
        async def on_pipeline_error(worker_instance: Any, frame: Any):
            logger.error(
                "Pipeline error for %s: %s",
                session.call_id,
                getattr(frame, "error", frame),
            )

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(
            transport_instance: Any, client: Any
        ):
            session.end_reason = session.end_reason or "client_disconnect"
            asyncio.create_task(session.request_stop(session.end_reason))

        session.runner_task = asyncio.create_task(
            session.runner.run(auto_end=False)
        )
        logger.info("Pipecat pipeline started for call %s", session.call_id)

    except Exception:
        logger.exception("Failed to start Pipecat pipeline for %s", session.call_id)
        await session.finalize(
            status="error",
            end_reason="error",
        )
        active_sessions.pop(session.call_id, None)


@app.post("/offer")
async def handle_webrtc_offer(payload: dict):
    if reporter is None:
        raise HTTPException(status_code=500, detail="Reporter not initialized")

    request = SmallWebRTCRequest.from_dict(payload)
    request_call_id = None
    if isinstance(request.request_data, dict):
        request_call_id = request.request_data.get("call_id")

    call_id = request_call_id or str(uuid.uuid4())
    if call_id in active_sessions:
        raise HTTPException(status_code=409, detail="Call ID is already active")

    current_call_id.set(call_id)
    session = CallSession(call_id, reporter)
    active_sessions[call_id] = session
    session.start_timer()

    async def on_connection(connection: Any):
        await _run_session(session, connection)

    answer = await webrtc_handler.handle_web_request(request, on_connection)
    if answer is None:
        active_sessions.pop(call_id, None)
        raise HTTPException(status_code=500, detail="No WebRTC answer generated")

    return {
        **answer,
        "call_id": call_id,
    }


@app.patch("/offer")
async def handle_ice_candidates(payload: dict):
    try:
        request = SmallWebRTCPatchRequest(
            pc_id=payload["pc_id"],
            candidates=[
                IceCandidate(
                    candidate=item.get("candidate", ""),
                    sdp_mid=item.get("sdp_mid"),
                    sdp_mline_index=item.get("sdp_mline_index"),
                )
                for item in payload.get("candidates", [])
            ],
        )
        await webrtc_handler.handle_patch_request(request)
        return {"status": "ok", "pc_id": request.pc_id}
    except KeyError as exc:
        raise HTTPException(
            status_code=400, detail=f"Missing field: {exc.args[0]}"
        ) from exc


@app.post("/hangup/{call_id}")
async def handle_hangup(call_id: str):
    session = active_sessions.get(call_id)
    if not session:
        return {
            "message": "Call already finalized or not found",
            "call_id": call_id,
            "persisted": True,
        }

    session.end_reason = "user_hangup"
    await session.request_stop("user_hangup")

    if session.runner_task:
        try:
            await asyncio.wait_for(asyncio.shield(session.runner_task), timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            pass

    persisted = await session.finalize(
        status="completed",
        end_reason="user_hangup",
    )
    active_sessions.pop(call_id, None)

    return {
        "message": "Call finalized",
        "call_id": call_id,
        "persisted": bool(persisted),
        "spooled": not bool(persisted),
    }


def main() -> None:
    import uvicorn

    uvicorn.run(
        "bot.bot:app",
        host=settings.bot_host,
        port=settings.bot_port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
