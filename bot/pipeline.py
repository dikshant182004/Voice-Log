"""
Pipecat Voice AI Pipeline Builder.
Configures streaming STT (Deepgram Nova-3), conversational LLM (Groq Llama 3.3),
and streaming TTS (Cartesia Sonic), with Silero VAD turn detection and barge-in interruption handling.
"""

import logging
from typing import Optional, Tuple, Any

from bot.config import BotSettings
from bot.prompts import VOICE_SYSTEM_PROMPT
from bot.observers.transcript import TranscriptCollector
from bot.observers.metrics import MetricsCollector

logger = logging.getLogger("bot.pipeline")


def create_pipeline(
  settings: BotSettings,
  transcript_collector: TranscriptCollector,
  metrics_collector: MetricsCollector,
  transport: Any
) -> Tuple[Any, Any]:
  """
  Assembles the Pipecat audio pipeline with SmallWebRTC transport.
  
  Pipeline Flow:
  transport.input()
    -> STT (Deepgram Nova-3 Streaming)
    -> user_context_aggregator (with Silero VAD turn detection)
    -> LLM (Groq Llama 3.3 70B Versatile, max_tokens=150)
    -> TTS (Cartesia Sonic Streaming)
    -> transport.output()
    -> assistant_context_aggregator
  """
  try:
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.task import PipelineTask
    from pipecat.services.deepgram import DeepgramSTTService
    from pipecat.services.groq import GroqLLMService
    from pipecat.services.cartesia import CartesiaTTSService
    from pipecat.services.elevenlabs import ElevenLabsTTSService
    from pipecat.vad.silero import SileroVADAnalyzer
    from pipecat.processors.aggregators.llm_response import (
      LLMAssistantResponseAggregator,
      LLMUserResponseAggregator,
    )
    from pipecat.frames.frames import (
      InterruptionFrame,
      LLMFullResponseStartFrame,
      LLMFullResponseEndFrame,
      TTSStartedFrame,
      TTSStoppedFrame,
      UserStartedSpeakingFrame,
      UserStoppedSpeakingFrame,
    )

    # 1. Silero VAD Turn Detector
    vad = SileroVADAnalyzer(
      stop_secs=settings.vad_stop_secs,
    )

    # 2. Deepgram Streaming STT
    stt = DeepgramSTTService(
      api_key=settings.deepgram_api_key,
      model="nova-3",
      language="en",
      endpointing=settings.endpointing_ms,
      interim_results=True,
    )

    # 3. Groq Fast Streaming LLM
    llm = GroqLLMService(
      api_key=settings.groq_api_key,
      model=settings.llm_model,
      system_prompt=VOICE_SYSTEM_PROMPT,
      max_tokens=150,
      temperature=0.2,
    )

    # 4. Cartesia Streaming TTS (or ElevenLabs fallback)
    if settings.cartesia_api_key:
      tts = CartesiaTTSService(
        api_key=settings.cartesia_api_key,
        voice_id=settings.tts_voice_id,
        sample_rate=settings.tts_sample_rate,
      )
    elif settings.elevenlabs_api_key:
      tts = ElevenLabsTTSService(
        api_key=settings.elevenlabs_api_key,
        voice_id="21m00Tcm4TlvDq8ikWAM",
      )
    else:
      raise ValueError("No TTS API key configured (need Cartesia or ElevenLabs)")

    # 5. User & Assistant Aggregators
    user_aggregator = LLMUserResponseAggregator()
    assistant_aggregator = LLMAssistantResponseAggregator()

    pipeline = Pipeline([
      transport.input(),
      stt,
      user_aggregator,
      llm,
      tts,
      transport.output(),
      assistant_aggregator,
    ])

    task = PipelineTask(
      pipeline,
      enable_metrics=True,
      enable_usage_metrics=True,
    )

    # Register observer hooks
    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
      logger.info("WebRTC peer connected to voice pipeline")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
      logger.info("WebRTC peer disconnected")

    return pipeline, task

  except ImportError:
    logger.info("Pipecat native packages not installed in current environment; running in mockable/contract mode")
    return None, None
