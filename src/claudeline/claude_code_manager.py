"""
Claude Code subprocess manager.

Manages a Claude Code process, sending commands and streaming output back.
Uses `claude -p` (print mode) with `--continue` to maintain conversation
context.
"""

import asyncio
import json
import logging
import os
import shutil
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class SessionState:
    """Tracks state for a Claude Code conversation."""

    session_id: str | None = None
    is_running: bool = False
    command_history: list[str] = field(default_factory=list)


class ClaudeCodeManager:
    """Manages Claude Code subprocess execution."""

    def __init__(self, work_dir: str = ".", claude_command: str = "claude"):
        self.work_dir = os.path.abspath(work_dir)
        self.claude_command = claude_command
        self.session = SessionState()
        self._current_process: asyncio.subprocess.Process | None = None

    def _find_claude(self) -> str:
        """Find the claude command, checking common locations."""
        # Try the configured command directly
        found = shutil.which(self.claude_command)
        if found:
            return found

        # Common installation paths
        candidates = [
            os.path.expanduser("~/.npm-global/bin/claude"),
            os.path.expanduser("~/.local/bin/claude"),
            "/usr/local/bin/claude",
        ]
        for path in candidates:
            if os.path.isfile(path) and os.access(path, os.X_OK):
                return path

        return self.claude_command  # Fall back, let it fail clearly

    async def execute(
        self,
        prompt: str,
        on_output: Callable[[str], Coroutine[Any, Any, None]],
    ) -> dict:
        """
        Execute a prompt via Claude Code and stream output.

        Args:
            prompt: The user's instruction/command
            on_output: async callback(chunk: str) called with each chunk

        Returns:
            dict with "success", "output" (full text), optionally "error"
        """
        if self.session.is_running:
            return {
                "success": False,
                "output": "",
                "error": (
                    "A command is already running. Wait for it to finish or cancel it."
                ),
            }

        self.session.is_running = True
        self.session.command_history.append(prompt)
        claude_path = self._find_claude()

        # Build command: --output-format stream-json for parseable output
        cmd = [claude_path, "-p", "--verbose", "--output-format", "stream-json"]

        # Continue previous conversation if we have a session
        if self.session.session_id:
            cmd.extend(["--resume", self.session.session_id])

        cmd.append(prompt)

        full_output = []

        try:
            self._current_process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.work_dir,
                env={**os.environ, "TERM": "dumb", "NO_COLOR": "1"},
            )

            # Stream stdout line by line (one JSON object per line)
            assert self._current_process.stdout is not None
            async for line in self._current_process.stdout:
                decoded = line.decode("utf-8", errors="replace").strip()
                if not decoded:
                    continue

                chunk_text = self._parse_stream_json(decoded)
                if chunk_text:
                    full_output.append(chunk_text)
                    await on_output(chunk_text)

            await self._current_process.wait()
            return_code = self._current_process.returncode

            # Read any stderr
            assert self._current_process.stderr is not None
            stderr_bytes = await self._current_process.stderr.read()
            stderr_text = stderr_bytes.decode("utf-8", errors="replace").strip()

            if return_code != 0 and not full_output:
                error_msg = stderr_text or f"Claude Code exited with code {return_code}"
                await on_output(f"\n[Error: {error_msg}]")
                return {
                    "success": False,
                    "output": error_msg,
                    "error": error_msg,
                }

            return {"success": True, "output": "".join(full_output)}

        except FileNotFoundError:
            error_msg = (
                f"Claude Code not found at '{claude_path}'. "
                "Make sure it's installed and in your PATH."
            )
            await on_output(f"[Error: {error_msg}]")
            return {
                "success": False,
                "output": "",
                "error": error_msg,
            }
        except Exception as e:
            error_msg = f"Error running Claude Code: {e}"
            logger.exception(error_msg)
            await on_output(f"[Error: {error_msg}]")
            return {
                "success": False,
                "output": "",
                "error": error_msg,
            }
        finally:
            self.session.is_running = False
            self._current_process = None

    def _parse_stream_json(self, line: str) -> str | None:
        """Parse a line of stream-json output from Claude Code."""
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            # Not JSON — might be plain text output, return as-is
            return line + "\n"

        msg_type = data.get("type", "")

        # Extract session ID from init message
        if msg_type == "system" and "session_id" in data:
            self.session.session_id = data["session_id"]
            return None

        # Content block text delta
        if msg_type == "assistant" and "message" in data:
            message = data["message"]
            if isinstance(message, str):
                return message
            # Handle structured content blocks
            content = message.get("content", [])
            parts = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        parts.append(block.get("text", ""))
                    elif block.get("type") == "tool_use":
                        tool_name = block.get("name", "tool")
                        parts.append(f"\n[Using tool: {tool_name}]\n")
                elif isinstance(block, str):
                    parts.append(block)
            return "".join(parts) if parts else None

        # Result message
        if msg_type == "result":
            result_text: str = data.get("result", "")
            # Capture session ID if present
            if "session_id" in data:
                self.session.session_id = data["session_id"]
            if result_text:
                return result_text
            # Check for subtype content
            if data.get("subtype") == "success":
                return None  # Already got the content via streaming
            return None

        return None

    async def cancel(self) -> bool:
        """Cancel the currently running command."""
        if self._current_process and self.session.is_running:
            try:
                self._current_process.terminate()
                await asyncio.sleep(0.5)
                if self._current_process.returncode is None:
                    self._current_process.kill()
                return True
            except Exception:
                return False
        return False

    def reset_session(self):
        """Start a fresh conversation (lose context)."""
        self.session = SessionState()
