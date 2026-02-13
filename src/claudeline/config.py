"""Configuration for Claude Voice Bridge."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Server
    host: str = "0.0.0.0"
    port: int = 8765

    # Transcription
    transcription_provider: str = "groq"  # "groq" or "openai"
    groq_api_key: str = ""
    openai_api_key: str = ""
    whisper_model: str = "whisper-large-v3-turbo"  # Groq model name

    # Claude Code
    claude_work_dir: str = "."
    claude_command: str = "claude"

    # SSL
    ssl_certfile: str = ""
    ssl_keyfile: str = ""

    # Text cleanup (LLM post-processing of transcription)
    cleanup_enabled: bool = False
    cleanup_provider: str = "anthropic"  # "anthropic" or "openai"
    anthropic_api_key: str = ""
    cleanup_model: str = "claude-sonnet-4-20250514"

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def ssl_enabled(self) -> bool:
        return bool(self.ssl_certfile and self.ssl_keyfile)

    @property
    def transcription_api_key(self) -> str:
        if self.transcription_provider == "groq":
            return self.groq_api_key
        return self.openai_api_key

    @property
    def transcription_api_url(self) -> str:
        if self.transcription_provider == "groq":
            return "https://api.groq.com/openai/v1/audio/transcriptions"
        return "https://api.openai.com/v1/audio/transcriptions"


settings = Settings()
