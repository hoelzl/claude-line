"""Audio transcription via Whisper API (Groq or OpenAI)."""

import httpx

from .config import settings


async def transcribe_audio(audio_bytes: bytes, mime_type: str = "audio/webm") -> dict:
    """
    Send audio to Whisper API and return transcription.

    Returns:
        dict with "text" (transcribed string) and "success" (bool).
    """
    api_key = settings.transcription_api_key
    if not api_key:
        provider = settings.transcription_provider
        env_var = "GROQ_API_KEY" if provider == "groq" else "OPENAI_API_KEY"
        return {
            "text": "",
            "success": False,
            "error": f"No API key set for {provider}. Set {env_var}.",
        }

    # Map common browser MIME types to file extensions
    ext_map = {
        "audio/webm": "webm",
        "audio/mp4": "m4a",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/mpeg": "mp3",
        "audio/x-m4a": "m4a",
    }
    ext = ext_map.get(mime_type, "webm")
    filename = f"recording.{ext}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                settings.transcription_api_url,
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (filename, audio_bytes, mime_type)},
                data={
                    "model": settings.whisper_model,
                    "response_format": "json",
                    "language": "en",
                },
            )
            response.raise_for_status()
            result = response.json()
            return {
                "text": result.get("text", "").strip(),
                "success": True,
            }
        except httpx.HTTPStatusError as e:
            error_body = e.response.text[:500]
            return {
                "text": "",
                "success": False,
                "error": (
                    f"Transcription API error ({e.response.status_code}): {error_body}"
                ),
            }
        except Exception as e:
            return {
                "text": "",
                "success": False,
                "error": f"Transcription failed: {e}",
            }
