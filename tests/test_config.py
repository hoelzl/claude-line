"""Tests for claudeline.config module."""

from claudeline.config import Settings


class TestSettingsDefaults:
    """Test that Settings has correct default values."""

    def test_default_host(self):
        s = Settings(groq_api_key="test")
        assert s.host == "0.0.0.0"

    def test_default_port(self):
        s = Settings(groq_api_key="test")
        assert s.port == 8765

    def test_default_transcription_provider(self):
        s = Settings(groq_api_key="test")
        assert s.transcription_provider == "groq"

    def test_default_whisper_model(self):
        s = Settings(groq_api_key="test")
        assert s.whisper_model == "whisper-large-v3-turbo"

    def test_default_claude_work_dir(self):
        s = Settings(groq_api_key="test")
        assert s.claude_work_dir == "."

    def test_default_claude_command(self):
        s = Settings(groq_api_key="test")
        assert s.claude_command == "claude"

    def test_default_cleanup_disabled(self):
        s = Settings(groq_api_key="test")
        assert s.cleanup_enabled is False

    def test_default_cleanup_provider(self):
        s = Settings(groq_api_key="test")
        assert s.cleanup_provider == "anthropic"


class TestSettingsTranscriptionProperties:
    """Test transcription-related properties."""

    def test_groq_api_key_when_provider_is_groq(self):
        s = Settings(transcription_provider="groq", groq_api_key="groq-key")
        assert s.transcription_api_key == "groq-key"

    def test_openai_api_key_when_provider_is_openai(self):
        s = Settings(transcription_provider="openai", openai_api_key="openai-key")
        assert s.transcription_api_key == "openai-key"

    def test_groq_api_url_when_provider_is_groq(self):
        s = Settings(transcription_provider="groq", groq_api_key="test")
        assert "groq.com" in s.transcription_api_url

    def test_openai_api_url_when_provider_is_openai(self):
        s = Settings(transcription_provider="openai", openai_api_key="test")
        assert "openai.com" in s.transcription_api_url
