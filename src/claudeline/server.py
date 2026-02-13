"""
Claude Line — FastAPI server.

Serves the mobile web UI and handles WebSocket communication
for audio recording, transcription, and Claude Code interaction.
"""

import json
import logging
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .claude_code_manager import ClaudeCodeManager
from .config import settings
from .text_cleanup import cleanup_text
from .transcription import transcribe_audio

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Claude Line")

# Serve static files
static_dir = Path(__file__).parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

# One Claude Code manager per server (single-user tool)
claude_manager = ClaudeCodeManager(
    work_dir=settings.claude_work_dir,
    claude_command=settings.claude_command,
)


@app.get("/")
async def index():
    """Serve the mobile web UI."""
    index_path = static_dir / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return HTMLResponse("<h1>Claude Line</h1><p>static/index.html not found</p>")


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "transcription_provider": settings.transcription_provider,
        "cleanup_enabled": settings.cleanup_enabled,
        "work_dir": settings.claude_work_dir,
        "session_active": claude_manager.session.session_id is not None,
    }


def _format_work_dir(path: str) -> str:
    """Format a working directory path for compact display.

    Shows the last 2 path components, prefixed with .../ for longer paths.
    """
    parts = Path(path).parts
    if len(parts) <= 2:
        return path
    return ".../{}".format("/".join(parts[-2:]))


async def send_ws(ws: WebSocket, msg_type: str, **kwargs):
    """Send a typed JSON message over WebSocket."""
    await ws.send_json({"type": msg_type, **kwargs})


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    Main WebSocket handler. Protocol:

    Client -> Server:
        {"type": "audio", "data": "<base64>", "mime_type": "audio/webm"}
        {"type": "send", "text": "the command to send to claude code"}
        {"type": "cancel"}
        {"type": "reset"}

    Server -> Client:
        {"type": "transcription", "text": "...", "success": true}
        {"type": "cleanup", "text": "...", "original": "...", "success": true}
        {"type": "claude_chunk", "text": "..."}
        {"type": "claude_done", "success": true, "output": "..."}
        {"type": "status", "message": "..."}
        {"type": "error", "message": "..."}
    """
    await ws.accept()
    logger.info("WebSocket client connected")

    await send_ws(
        ws,
        "config",
        work_dir=claude_manager.work_dir,
        work_dir_display=_format_work_dir(claude_manager.work_dir),
    )

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await send_ws(ws, "error", message="Invalid JSON")
                continue

            msg_type = msg.get("type", "")

            if msg_type == "audio":
                await handle_audio(ws, msg)
            elif msg_type == "send":
                await handle_send(ws, msg)
            elif msg_type == "cancel":
                await handle_cancel(ws)
            elif msg_type == "reset":
                await handle_reset(ws)
            else:
                await send_ws(ws, "error", message=f"Unknown message type: {msg_type}")

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.exception(f"WebSocket error: {e}")


async def handle_audio(ws: WebSocket, msg: dict):
    """Handle incoming audio data — transcribe and optionally clean up."""
    import base64

    audio_b64 = msg.get("data", "")
    mime_type = msg.get("mime_type", "audio/webm")

    if not audio_b64:
        await send_ws(ws, "error", message="No audio data received")
        return

    await send_ws(ws, "status", message="Transcribing...")

    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception:
        await send_ws(ws, "error", message="Invalid base64 audio data")
        return

    # Step 1: Transcribe
    result = await transcribe_audio(audio_bytes, mime_type)
    await send_ws(ws, "transcription", **result)

    if not result.get("success") or not result.get("text"):
        return

    # Step 2: Cleanup (if enabled)
    if settings.cleanup_enabled:
        await send_ws(ws, "status", message="Cleaning up text...")
        cleanup_result = await cleanup_text(result["text"])
        await send_ws(ws, "cleanup", **cleanup_result)


async def handle_send(ws: WebSocket, msg: dict):
    """Send a command to Claude Code and stream the response."""
    text = msg.get("text", "").strip()
    if not text:
        await send_ws(ws, "error", message="Empty command")
        return

    await send_ws(ws, "status", message="Running Claude Code...")

    async def on_chunk(chunk: str):
        await send_ws(ws, "claude_chunk", text=chunk)

    result = await claude_manager.execute(text, on_output=on_chunk)
    await send_ws(ws, "claude_done", **result)


async def handle_cancel(ws: WebSocket):
    """Cancel the running Claude Code command."""
    cancelled = await claude_manager.cancel()
    if cancelled:
        await send_ws(ws, "status", message="Command cancelled", auto_dismiss=2000)
    else:
        await send_ws(ws, "status", message="Nothing to cancel", auto_dismiss=2000)


async def handle_reset(ws: WebSocket):
    """Reset the Claude Code session (start fresh conversation)."""
    claude_manager.reset_session()
    await send_ws(
        ws,
        "status",
        message="Session reset — starting fresh conversation",
        auto_dismiss=2000,
    )


def run_server(
    host: str | None = None,
    port: int | None = None,
    ssl_certfile: str | None = None,
    ssl_keyfile: str | None = None,
):
    """Start the Claude Line server."""
    server_host = host or settings.host
    server_port = port or settings.port

    # Resolve SSL: CLI arg → env var → disabled
    cert = ssl_certfile or settings.ssl_certfile or None
    key = ssl_keyfile or settings.ssl_keyfile or None
    use_ssl = bool(cert and key)
    protocol = "https" if use_ssl else "http"

    logger.info(f"Starting Claude Line on {server_host}:{server_port}")
    logger.info(f"Transcription provider: {settings.transcription_provider}")
    logger.info(f"Claude Code work dir: {settings.claude_work_dir}")
    cleanup_status = "enabled" if settings.cleanup_enabled else "disabled"
    logger.info(f"Text cleanup: {cleanup_status}")
    logger.info(f"Open {protocol}://<your-ip>:{server_port} on your phone")

    uvicorn_kwargs: dict = {
        "host": server_host,
        "port": server_port,
        "reload": False,
        "log_level": "info",
    }
    if use_ssl:
        uvicorn_kwargs["ssl_certfile"] = cert
        uvicorn_kwargs["ssl_keyfile"] = key

    uvicorn.run("claudeline.server:app", **uvicorn_kwargs)


if __name__ == "__main__":
    run_server()
