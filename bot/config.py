"""
Typed configuration for the Pipecat voice bot.
"""

from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class BotSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    deepgram_api_key: str = Field(default="")
    groq_api_key: str = Field(default="")
    cartesia_api_key: str = Field(default="")
    elevenlabs_api_key: Optional[str] = Field(default=None)

    stt_model: str = Field(default="nova-3-general")
    llm_model: str = Field(default="openai/gpt-oss-20b")
    tts_provider: str = Field(default="cartesia")
    tts_model: str = Field(default="sonic-3.6")
    tts_voice_id: str = Field(default="79a125e8-cd45-4c13-8a67-188112f4dd22")
    elevenlabs_voice_id: str = Field(default="21m00Tcm4TlvDq8ikWAM")
    tts_sample_rate: int = Field(default=24000)

    worker_base_url: str = Field(default="http://localhost:8787")
    ingest_token: str = Field(default="")

    vad_stop_secs: float = Field(default=0.30)
    endpointing_ms: int = Field(default=200)

    max_call_seconds: int = Field(default=600)
    idle_timeout_seconds: int = Field(default=60)

    bot_host: str = Field(default="127.0.0.1")
    bot_port: int = Field(default=8765)
    allowed_origins: str = Field(default="http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173")
    enable_debug_endpoints: bool = Field(default=False)

    def get_allowed_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    def validate_keys(self) -> None:
        missing: list[str] = []

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
                "Missing required environment variables for voice bot: "
                + ", ".join(missing)
            )


settings = BotSettings()
