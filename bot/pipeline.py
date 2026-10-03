"""Pipecat 1.12.0 voice pipeline for the Mini Call Log service.

Audio path:
SmallWebRTC input -> Deepgram STT -> user aggregator/VAD -> Groq -> Cartesia/ElevenLabs -> WebRTC output.
Transcript and latency processors observe the real Pipecat frames without creating a second
speech-recognition path in the browser.
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
    from pipecat.audio.vad.vad_analyzer import VADParams
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
    from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
    from pipecat.audio.turn.smart_turn.base_smart_turn import SmartTurnParams
    from pipecat.turns.user_start.vad_user_turn_start_strategy import VADUserTurnStartStrategy
    from pipecat.turns.user_stop.turn_analyzer_user_turn_stop_strategy import TurnAnalyzerUserTurnStopStrategy
    from pipecat.turns.user_turn_strategies import UserTurnStrategies

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
    vad = SileroVADAnalyzer(
        sample_rate=16000,
        params=VADParams(
            stop_secs=settings.vad_stop_secs,
        ),
    )

    # Only VAD is allowed to start a user turn. Pipecat's default also includes
    # TranscriptionUserTurnStartStrategy, which can treat a late/interim
    # Deepgram result as a brand-new turn and interrupt an LLM response.
    # This prevents utterances such as "Do you support product" from being
    # split into "Do you support" and "product".
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=vad,
            user_turn_strategies=UserTurnStrategies(
                start=[VADUserTurnStartStrategy(enable_interruptions=True)],
                stop=[
                    TurnAnalyzerUserTurnStopStrategy(
                        turn_analyzer=LocalSmartTurnAnalyzerV3(
                            params=SmartTurnParams(
                                stop_secs=settings.smart_turn_stop_secs,
                            )
                        )
                    )
                ],
            ),
        ),
    )

    user_transcript = TranscriptProcessor(transcript_collector)
    stt_metrics = MetricsProcessor(metrics_collector)
    turn_metrics = MetricsProcessor(metrics_collector, observe_user_turn=True)
    assistant_transcript = TranscriptProcessor(transcript_collector)
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
            llm,
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
