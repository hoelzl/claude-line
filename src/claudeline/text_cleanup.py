"""
Text cleanup: convert spoken/dictated text into clean written instructions.

Handles false starts, corrections, filler words, and restructures speech
into the kind of precise text you'd type on a keyboard.

This module is designed to be enabled later via CLEANUP_ENABLED=true.
"""

import httpx

from .config import settings

CLEANUP_SYSTEM_PROMPT = """\
You are a text cleanup assistant. Your job is to take transcribed speech \
— which may contain false starts, self-corrections, filler words, \
repetitions, and conversational artifacts — and convert it into clean, \
precise written text suitable as instructions for a coding assistant \
(Claude Code).

Rules:
- Preserve the user's intent exactly. Do not add, infer, or remove \
instructions.
- Remove filler words (um, uh, like, you know, so, basically, etc.)
- Resolve self-corrections: if the user says "no wait, I mean X", \
keep only X.
- Collapse repetitions into single statements.
- Fix obvious grammar issues that arise from speech patterns.
- Keep technical terms, file paths, variable names, and code references \
exactly as spoken.
- Output ONLY the cleaned text, nothing else. No preamble, no explanation.
- If the input is already clean, return it unchanged.
"""


async def cleanup_text(raw_text: str) -> dict:
    """
    Run an LLM cleanup pass on transcribed text.

    Returns:
        dict with "text" (cleaned), "original" (raw input), "success".
    """
    if not settings.cleanup_enabled:
        return {
            "text": raw_text,
            "original": raw_text,
            "success": True,
            "skipped": True,
        }

    if settings.cleanup_provider == "anthropic":
        return await _cleanup_anthropic(raw_text)
    elif settings.cleanup_provider == "openai":
        return await _cleanup_openai(raw_text)
    else:
        return {
            "text": raw_text,
            "original": raw_text,
            "success": False,
            "error": (f"Unknown cleanup provider: {settings.cleanup_provider}"),
        }


async def _cleanup_anthropic(raw_text: str) -> dict:
    api_key = settings.anthropic_api_key
    if not api_key:
        return {
            "text": raw_text,
            "original": raw_text,
            "success": False,
            "error": "ANTHROPIC_API_KEY not set",
        }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": settings.cleanup_model,
                    "max_tokens": 2048,
                    "system": CLEANUP_SYSTEM_PROMPT,
                    "messages": [{"role": "user", "content": raw_text}],
                },
            )
            response.raise_for_status()
            result = response.json()
            cleaned = result["content"][0]["text"].strip()
            return {
                "text": cleaned,
                "original": raw_text,
                "success": True,
            }
        except Exception as e:
            return {
                "text": raw_text,
                "original": raw_text,
                "success": False,
                "error": f"Cleanup failed: {e}",
            }


async def _cleanup_openai(raw_text: str) -> dict:
    api_key = settings.openai_api_key
    if not api_key:
        return {
            "text": raw_text,
            "original": raw_text,
            "success": False,
            "error": "OPENAI_API_KEY not set",
        }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {
                            "role": "system",
                            "content": CLEANUP_SYSTEM_PROMPT,
                        },
                        {"role": "user", "content": raw_text},
                    ],
                    "max_tokens": 2048,
                    "temperature": 0.1,
                },
            )
            response.raise_for_status()
            result = response.json()
            cleaned = result["choices"][0]["message"]["content"].strip()
            return {
                "text": cleaned,
                "original": raw_text,
                "success": True,
            }
        except Exception as e:
            return {
                "text": raw_text,
                "original": raw_text,
                "success": False,
                "error": f"Cleanup failed: {e}",
            }
