"""
Configuration management for the Pipecat Voice Bot.
Loads typed settings from environment variables using Pydantic Settings.
Fails fast at startup if required variables are missing.
"""

from typing import Optional, List
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
  stt_model: str = Field(default="nova-3", description="Deepgram model name")
  llm_model: str = Field(default="llama-3.3-70b-versatile", description="Groq model identifier")
  tts_provider: str = Field(default="cartesia", description="Primary TTS provider: cartesia or elevenlabs")
  tts_voice_id: str = Field(
    default="79a125e8-cd45-4c13-8a67-188112f4dd22",
    description="Cartesia conversational voice ID"
  )
  tts_sample_rate: int = Field(default=16000, description="Audio sample rate (Hz)")

  # --- Cloudflare Worker Target ---
  worker_base_url: str = Field(
    default="http://localhost:8787",
    description="Cloudflare Worker base URL for call ingestion"
  )
  ingest_token: str = Field(
    default="",
    description="Bearer authentication token for POST /calls (REQUIRED, no default)"
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

  # --- Bot Server Security & Network Binding ---
  bot_host: str = Field(default="127.0.0.1", description="Bind strictly to loopback by default")
  bot_port: int = Field(default=8765)
  allowed_origins: str = Field(
    default="http://localhost:3000",
    description="Allowed CORS origins (comma-separated or single URL)"
  )
  enable_debug_endpoints: bool = Field(
    default=False,
    description="Enable simulate_call debug endpoints (MUST be False in production)"
  )

  def get_allowed_origins_list(self) -> List[str]:
    return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

  def validate_keys(self) -> None:
    """Validate that required variables are set before accepting traffic."""
    missing = []
    if not self.deepgram_api_key:
      missing.append("DEEPGRAM_API_KEY")
    if not self.groq_api_key:
      missing.append("GROQ_API_KEY")
    if self.tts_provider == "cartesia" and not self.cartesia_api_key:
      missing.append("CARTESIA_API_KEY")
    elif self.tts_provider == "elevenlabs" and not self.elevenlabs_api_key:
      missing.append("ELEVENLABS_API_KEY")
    if not self.ingest_token:
      missing.append("INGEST_TOKEN")

    if missing:
      raise ValueError(
        f"Missing required environment variables for voice bot: {', '.join(missing)}. "
        "Set them in .env or your deployment environment."
      )


# Global settings instance
settings = BotSettings()
