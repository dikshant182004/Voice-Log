"""
Configuration management for the Pipecat Voice Bot.
Loads typed settings from environment variables using Pydantic Settings.
Fails fast with clear descriptive error messages if required variables are missing.
"""

from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class BotSettings(BaseSettings):
  model_config = SettingsConfigDict(
    env_file=".env",
    env_file_encoding="utf-8",
    extra="ignore",
  )

  # --- Voice AI Provider API Keys ---
  deepgram_api_key: str = Field(
    default="",
    description="Deepgram API key for streaming speech-to-text (Nova-3)"
  )
  groq_api_key: str = Field(
    default="",
    description="Groq API key for low-latency LLM inference"
  )
  cartesia_api_key: str = Field(
    default="",
    description="Cartesia API key for streaming text-to-speech (Sonic)"
  )
  elevenlabs_api_key: Optional[str] = Field(
    default=None,
    description="Optional ElevenLabs API key for TTS fallback"
  )

  # --- Provider & Model Identifiers ---
  stt_model: str = Field(default="deepgram:nova-3")
  llm_model: str = Field(default="llama-3.3-70b-versatile")
  tts_voice_id: str = Field(
    default="79a125e8-cd45-4c13-8a67-188112f4dd22",
    description="Cartesia British/American natural conversational voice ID"
  )
  tts_sample_rate: int = Field(default=16000, description="16000 or 24000 Hz")

  # --- Backend Cloudflare Worker Target ---
  worker_base_url: str = Field(
    default="http://localhost:8787",
    description="Cloudflare Worker base URL for call ingestion"
  )
  ingest_token: str = Field(
    default="dev_secret_token",
    description="Bearer authentication token for POST /calls"
  )

  # --- Latency & Turn Detection Tunables ---
  vad_stop_secs: float = Field(
    default=0.30,
    description="Silence duration in seconds before triggering end-of-speech (0.2s - 0.4s)"
  )
  endpointing_ms: int = Field(
    default=200,
    description="Deepgram endpointing threshold in milliseconds (150ms - 300ms)"
  )

  # --- Lifecycle & Cost Guardrails ---
  max_call_seconds: int = Field(
    default=600,
    description="Hard maximum call duration in seconds (10 minutes)"
  )
  idle_timeout_seconds: int = Field(
    default=60,
    description="Disconnect if user is silent for this duration"
  )

  # --- Bot Server Network Binding ---
  bot_host: str = Field(default="0.0.0.0")
  bot_port: int = Field(default=8765)

  def validate_keys(self) -> None:
    """Validate that essential keys are present when running live calls."""
    missing = []
    if not self.deepgram_api_key:
      missing.append("DEEPGRAM_API_KEY")
    if not self.groq_api_key:
      missing.append("GROQ_API_KEY")
    if not self.cartesia_api_key and not self.elevenlabs_api_key:
      missing.append("CARTESIA_API_KEY (or ELEVENLABS_API_KEY)")
    if missing:
      raise ValueError(f"Missing required environment variables for voice bot: {', '.join(missing)}")


# Global cached settings instance
settings = BotSettings()
