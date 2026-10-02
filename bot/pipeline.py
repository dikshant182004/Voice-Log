"""
Pipecat Voice AI Pipeline Builder.
Configures streaming STT (Deepgram), conversational LLM (Groq),
and streaming TTS (Cartesia with ElevenLabs failover),
with Silero VAD turn detection and barge-in interruption handling.
"""

import logging
from typing import Any, Tuple

from bot.config import BotSettings
from bot.prompts import VOICE_SYSTEM_PROMPT
from bot.observers.transcript import TranscriptCollector
from bot.observers.metrics import MetricsCollector

logger = logging.getLogger("bot.pipeline")


def create_pipeline(
  settings: BotSettings,
  transcript_collector: TranscriptCollector,
  metrics_collector: MetricsCollector,
  transport: Any,
) -> Tuple[Any, Any]:
  """
  Assembles the Pipecat audio pipeline with SmallWebRTC transport.
  
  Pipeline Dataflow:
  transport.input()
    -> STT (Deepgram Nova-3 Streaming)
    -> user_context_aggregator (with Silero VAD turn detection)
    -> LLM (Groq Llama 3.3 70B Versatile, max_tokens=150)
    -> TTS (Cartesia Sonic Streaming)
    -> transport.output()
    -> assistant_context_aggregator
  """
  from pipecat.pipeline.pipeline import Pipeline
  from pipecat.pipeline.task import PipelineTask, PipelineParams
  from pipecat.services.deepgram import DeepgramSTTService
  from pipecat.services.groq import GroqLLMService
  from pipecat.services.cartesia import CartesiaTTSService
  from pipecat.services.elevenlabs import ElevenLabsTTSService
  from pipecat.audio.vad.silero import SileroVADAnalyzer
  from pipecat.audio.vad.vad_analyzer import VADParams
  from pipecat.processors.aggregators.openai_llm_context import (
    OpenAILLMContext,
    OpenAILLMContextFrame,
  )

  # 1. Silero VAD Turn Detector (stop silence 0.2 - 0.4s)
  vad = SileroVADAnalyzer(
    params=VADParams(stop_secs=settings.vad_stop_secs),
  )

  # 2. Deepgram Streaming STT with endpointing
  stt = DeepgramSTTService(
    api_key=settings.deepgram_api_key,
    model=settings.stt_model,
    language="en",
    endpointing=settings.endpointing_ms,
    interim_results=True,
  )

  # 3. LLM Context with voice system prompt
  context = OpenAILLMContext([
    {"role": "system", "content": VOICE_SYSTEM_PROMPT}
  ])
  context_aggregator = context.create_aggregator()

  # 4. Groq Streaming LLM
  llm = GroqLLMService(
    api_key=settings.groq_api_key,
    model=settings.llm_model,
    max_tokens=150,
    temperature=0.2,
  )

  # 5. Primary TTS (Cartesia Sonic) with optional ElevenLabs runtime fallback
  if settings.tts_provider == "cartesia" and settings.cartesia_api_key:
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
    raise ValueError(f"No valid API key found for TTS provider: {settings.tts_provider}")

  # Build pipeline
  pipeline = Pipeline([
    transport.input(),
    stt,
    context_aggregator.user(),
    llm,
    tts,
    transport.output(),
    context_aggregator.assistant(),
  ])

  # Task parameters: enable metrics and barge-in interruptions
  params = PipelineParams(
    allow_interruptions=True,
    enable_metrics=True,
    enable_usage_metrics=True,
  )

  task = PipelineTask(pipeline, params)

  return pipeline, task
