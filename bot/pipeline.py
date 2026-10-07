"""Pipecat 1.12.0 voice pipeline for the Mini Call Log service.

Audio path:
SmallWebRTC input -> Deepgram STT -> VAD user-turn control -> Groq -> Cartesia/ElevenLabs -> WebRTC output.
Transcript and latency processors observe the real Pipecat frames without creating a second
speech-recognition path in the browser.

Turn detection uses VAD for the speech boundary, but the stop strategy waits briefly for
Deepgram's finalized transcript before submitting the LLM turn. A watchdog prevents a
broken STT/turn signal from holding a call forever.
"""

import logging
from typing import Any

from bot.config import BotSettings
from bot.observers.metrics import MetricsCollector, MetricsProcessor
from bot.observers.transcript import TranscriptCollector, TranscriptProcessor
from bot.prompts import VOICE_SYSTEM_PROMPT

logger = logging.getLogger("bot.pipeline")


def create_pipeline(
    settings: BotSettings,
    transcript_collector: TranscriptCollector,
    metrics_collector: MetricsCollector,
    transport: Any,
    agent_definition: dict[str, Any] | None = None,
):
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.audio.vad.vad_analyzer import VADParams
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.frames.frames import (
        ErrorFrame,
        LLMContextFrame,
        LLMFullResponseEndFrame,
        LLMFullResponseStartFrame,
    )
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
    from pipecat.pipeline.worker import PipelineParams, PipelineWorker
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.aggregators.llm_response_universal import (
        LLMContextAggregatorPair,
        LLMUserAggregatorParams,
    )
    from pipecat.services.cartesia.tts import CartesiaTTSService
    from pipecat.services.deepgram.stt import DeepgramSTTService
    from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
    from pipecat.services.groq.llm import GroqLLMService
    from pipecat.turns.user_start.vad_user_turn_start_strategy import (
        VADUserTurnStartStrategy,
    )
    from pipecat.turns.user_stop.speech_timeout_user_turn_stop_strategy import (
        SpeechTimeoutUserTurnStopStrategy,
    )
    from pipecat.turns.user_turn_strategies import UserTurnStrategies

    agent = agent_definition or {}
    model_config = agent.get("model") or {}
    voice_config = agent.get("voice") or {}
    system_instruction = "\n\n".join(
        part
        for part in (agent.get("persona", ""), agent.get("system_instructions", ""))
        if part
    ) or VOICE_SYSTEM_PROMPT
    stt = DeepgramSTTService(
        api_key=settings.deepgram_api_key,
        sample_rate=16000,
        encoding="linear16",
        channels=1,
        settings=DeepgramSTTService.Settings(
            model=settings.stt_model,
            language="en-US",
            endpointing=settings.endpointing_ms,
            interim_results=True,
            punctuate=True,
            smart_format=True,
        ),
    )

    llm = GroqLLMService(
        api_key=settings.groq_api_key,
        retry_timeout_secs=settings.llm_retry_timeout_seconds,
        retry_on_timeout=True,
        settings=GroqLLMService.Settings(
            model=str(model_config.get("model") or settings.llm_model),
            # Groq recommends a moderate temperature range for GPT-OSS. Keep
            # Keep reasoning low for interactive voice latency. Pipecat 1.12.0
            # passes Settings.extra directly to OpenAI AsyncCompletions.create(),
            # so include_reasoning cannot be placed there: the OpenAI SDK rejects
            # it as an unexpected Python keyword argument before the request is
            # sent to Groq. GPT-OSS reasoning is therefore left at Groq default
            # response handling; Pipecat consumes the normal assistant content.
            temperature=float(model_config.get("temperature", 0.6)),
            max_completion_tokens=int(model_config.get("max_output_tokens") or settings.llm_max_completion_tokens),
            reasoning_effort=str(model_config.get("reasoning_effort") or settings.llm_reasoning_effort),
            system_instruction=system_instruction,
        ),
    )

    if settings.tts_provider == "cartesia":
        tts = CartesiaTTSService(
            api_key=settings.cartesia_api_key,
            settings=CartesiaTTSService.Settings(
                model=str(voice_config.get("model") or settings.tts_model),
                voice=str(voice_config.get("voice_id") or settings.tts_voice_id),
            ),
            sample_rate=settings.tts_sample_rate,
            max_buffer_delay_ms=0,
        )
    elif settings.tts_provider == "elevenlabs":
        tts = ElevenLabsTTSService(
            api_key=settings.elevenlabs_api_key,
            settings=ElevenLabsTTSService.Settings(
                voice=settings.elevenlabs_voice_id,
            ),
        )
    else:
        raise ValueError(
            f"Unsupported TTS provider '{settings.tts_provider}'. "
            "Use 'cartesia' or 'elevenlabs'."
        )

    context = LLMContext()
    vad = SileroVADAnalyzer(
        sample_rate=16000,
        params=VADParams(stop_secs=settings.vad_stop_secs),
    )

    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=vad,
            user_turn_strategies=UserTurnStrategies(
                start=[VADUserTurnStartStrategy(enable_interruptions=True)],
                stop=[
                    SpeechTimeoutUserTurnStopStrategy(
                        user_speech_timeout=settings.user_speech_timeout,
                        # Do not submit the turn until Deepgram has had a chance
                        # to emit its finalized TranscriptionFrame. This avoids
                        # the exact silent-turn race seen in the call logs.
                        wait_for_transcript=True,
                    )
                ],
            ),
            # Hard safety net if STT never produces a final transcript.
            user_turn_stop_timeout=settings.user_turn_stop_timeout,
        ),
    )

    class LLMContextDiagnostics(FrameProcessor):
        """Validate and trace the exact frame that should start LLM inference.

        This processor is deliberately a pass-through. It never mutates the
        shared LLMContext, so it cannot consume or delay an inference frame.
        """

        async def process_frame(self, frame: Any, direction: FrameDirection):
            await super().process_frame(frame, direction)
            if isinstance(frame, LLMContextFrame):
                messages = frame.context.get_messages()
                user_messages = [
                    m.get("content", "")
                    for m in messages
                    if isinstance(m, dict) and m.get("role") == "user"
                ]
                last_user = str(user_messages[-1]).strip() if user_messages else ""
                logger.info(
                    "LLM context frame ready: messages=%d user=%r",
                    len(messages),
                    last_user[:160],
                )
            await self.push_frame(frame, direction)

    class LLMResponseDiagnostics(FrameProcessor):
        """Make provider-side failures visible without altering frame flow."""

        async def process_frame(self, frame: Any, direction: FrameDirection):
            await super().process_frame(frame, direction)
            if isinstance(frame, LLMFullResponseStartFrame):
                logger.info("LLM response started")
            elif isinstance(frame, LLMFullResponseEndFrame):
                logger.info("LLM response ended")
            elif isinstance(frame, ErrorFrame):
                logger.error(
                    "LLM/provider error: %s",
                    getattr(frame, "error", frame),
                )
            await self.push_frame(frame, direction)

    user_transcript = TranscriptProcessor(transcript_collector)
    stt_metrics = MetricsProcessor(metrics_collector)
    turn_metrics = MetricsProcessor(metrics_collector, observe_user_turn=True)
    context_diagnostics = LLMContextDiagnostics()
    assistant_transcript = TranscriptProcessor(transcript_collector)
    llm_diagnostics = LLMResponseDiagnostics()
    llm_metrics = MetricsProcessor(metrics_collector)
    output_metrics = MetricsProcessor(metrics_collector)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_transcript,
            stt_metrics,
            user_aggregator,
            turn_metrics,
            context_diagnostics,
            llm,
            llm_diagnostics,
            assistant_transcript,
            llm_metrics,
            tts,
            output_metrics,
            transport.output(),
            assistant_aggregator,
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,
            audio_out_sample_rate=settings.tts_sample_rate,
            enable_metrics=True,
            enable_usage_metrics=True,
            send_initial_empty_metrics=True,
        ),
        idle_timeout_secs=settings.idle_timeout_seconds,
        cancel_on_idle_timeout=True,
        cancel_runner_on_idle_timeout=False,
        enable_rtvi=True,
        conversation_id=None,
    )

    return pipeline, worker
