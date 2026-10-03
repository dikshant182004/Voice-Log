"""
Pipecat voice pipeline for the Mini Call Log service.

Pipecat 1.12.0 pipeline:
transport.input() -> Deepgram STT -> user aggregator (Silero VAD)
-> Groq LLM -> Cartesia/ElevenLabs TTS -> transport.output()
-> assistant aggregator.
"""

from typing import Any

from bot.config import BotSettings
from bot.observers.metrics import MetricsCollector, MetricsProcessor
from bot.observers.transcript import TranscriptCollector, TranscriptProcessor
from bot.prompts import VOICE_SYSTEM_PROMPT


def create_pipeline(
    settings: BotSettings,
    transcript_collector: TranscriptCollector,
    metrics_collector: MetricsCollector,
    transport: Any,
):
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.pipeline.pipeline import Pipeline
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

    stt = DeepgramSTTService(
        api_key=settings.deepgram_api_key,
        settings=DeepgramSTTService.Settings(
            model=settings.stt_model,
            language="en-US",
            endpointing=settings.endpointing_ms,
            interim_results=True,
            punctuate=True,
        ),
    )

    llm = GroqLLMService(
        api_key=settings.groq_api_key,
        settings=GroqLLMService.Settings(
            model=settings.llm_model,
            temperature=0.2,
            max_tokens=150,
            system_instruction=VOICE_SYSTEM_PROMPT,
        ),
    )

    if settings.tts_provider == "cartesia":
        tts = CartesiaTTSService(
            api_key=settings.cartesia_api_key,
            settings=CartesiaTTSService.Settings(
                model=settings.tts_model,
                voice=settings.tts_voice_id,
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
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    user_transcript = TranscriptProcessor(transcript_collector)
    assistant_transcript = TranscriptProcessor(transcript_collector)
    input_metrics = MetricsProcessor(metrics_collector)
    output_metrics = MetricsProcessor(metrics_collector)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_transcript,
            input_metrics,
            user_aggregator,
            llm,
            tts,
            assistant_transcript,
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
