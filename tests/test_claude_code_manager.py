"""Tests for claudeline.claude_code_manager module."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudeline.claude_code_manager import ClaudeCodeManager, SessionState


class TestSessionState:
    """Test SessionState dataclass."""

    def test_default_session_id_is_none(self):
        state = SessionState()
        assert state.session_id is None

    def test_default_is_not_running(self):
        state = SessionState()
        assert state.is_running is False

    def test_default_command_history_is_empty(self):
        state = SessionState()
        assert state.command_history == []

    def test_command_history_is_independent_between_instances(self):
        state1 = SessionState()
        state2 = SessionState()
        state1.command_history.append("cmd1")
        assert state2.command_history == []


class TestClaudeCodeManagerInit:
    """Test ClaudeCodeManager initialization."""

    def test_default_work_dir_is_absolute(self):
        manager = ClaudeCodeManager()
        # os.path.abspath(".") should produce an absolute path
        assert manager.work_dir != "."
        assert len(manager.work_dir) > 1

    def test_custom_claude_command(self):
        manager = ClaudeCodeManager(claude_command="/usr/bin/claude")
        assert manager.claude_command == "/usr/bin/claude"

    def test_initial_session_state(self):
        manager = ClaudeCodeManager()
        assert manager.session.session_id is None
        assert manager.session.is_running is False
        assert manager.session.command_history == []

    def test_no_current_process_on_init(self):
        manager = ClaudeCodeManager()
        assert manager._current_process is None


class TestClaudeCodeManagerParseStreamJson:
    """Test the stream-json parser."""

    def test_extracts_session_id_from_system_message(self):
        manager = ClaudeCodeManager()
        line = json.dumps({"type": "system", "session_id": "abc-123"})
        result = manager._parse_stream_json(line)
        assert result is None
        assert manager.session.session_id == "abc-123"

    def test_extracts_text_from_assistant_string_message(self):
        manager = ClaudeCodeManager()
        line = json.dumps({"type": "assistant", "message": "Hello world"})
        result = manager._parse_stream_json(line)
        assert result == "Hello world"

    def test_extracts_text_from_assistant_content_blocks(self):
        manager = ClaudeCodeManager()
        line = json.dumps(
            {
                "type": "assistant",
                "message": {
                    "content": [{"type": "text", "text": "Some output"}],
                },
            }
        )
        result = manager._parse_stream_json(line)
        assert result == "Some output"

    def test_extracts_tool_use_from_content_blocks(self):
        manager = ClaudeCodeManager()
        line = json.dumps(
            {
                "type": "assistant",
                "message": {
                    "content": [{"type": "tool_use", "name": "Read"}],
                },
            }
        )
        result = manager._parse_stream_json(line)
        assert "Read" in result

    def test_extracts_result_text(self):
        manager = ClaudeCodeManager()
        line = json.dumps({"type": "result", "result": "Final output"})
        result = manager._parse_stream_json(line)
        assert result == "Final output"

    def test_captures_session_id_from_result(self):
        manager = ClaudeCodeManager()
        line = json.dumps(
            {
                "type": "result",
                "result": "",
                "session_id": "xyz-789",
                "subtype": "success",
            }
        )
        manager._parse_stream_json(line)
        assert manager.session.session_id == "xyz-789"

    def test_returns_line_as_is_for_non_json(self):
        manager = ClaudeCodeManager()
        result = manager._parse_stream_json("plain text output")
        assert result == "plain text output\n"

    def test_returns_none_for_unknown_type(self):
        manager = ClaudeCodeManager()
        line = json.dumps({"type": "unknown_type", "data": "something"})
        result = manager._parse_stream_json(line)
        assert result is None


class TestClaudeCodeManagerResetSession:
    """Test session reset."""

    def test_reset_clears_session_id(self):
        manager = ClaudeCodeManager()
        manager.session.session_id = "old-session"
        manager.reset_session()
        assert manager.session.session_id is None

    def test_reset_clears_command_history(self):
        manager = ClaudeCodeManager()
        manager.session.command_history.append("old command")
        manager.reset_session()
        assert manager.session.command_history == []

    def test_reset_clears_is_running(self):
        manager = ClaudeCodeManager()
        manager.session.is_running = True
        manager.reset_session()
        assert manager.session.is_running is False


class TestClaudeCodeManagerExecuteCommand:
    """Test that execute() builds the correct command line."""

    @pytest.fixture()
    def mock_process(self):
        """Create a mock subprocess that returns empty output."""
        process = AsyncMock()
        process.returncode = 0

        # stdout: async iterator yielding no lines
        stdout = AsyncMock()
        stdout.__aiter__ = MagicMock(return_value=iter([]))
        process.stdout = stdout

        # stderr
        stderr = AsyncMock()
        stderr.read = AsyncMock(return_value=b"")
        process.stderr = stderr

        process.wait = AsyncMock()
        return process

    @pytest.mark.asyncio
    async def test_command_includes_verbose_flag(self, mock_process):
        manager = ClaudeCodeManager(claude_command="claude")
        on_output = AsyncMock()

        with (
            patch(
                "claudeline.claude_code_manager.asyncio.create_subprocess_exec",
                return_value=mock_process,
            ) as mock_exec,
            patch.object(manager, "_find_claude", return_value="claude"),
        ):
            await manager.execute("test prompt", on_output=on_output)

            cmd_args = mock_exec.call_args[0]
            assert "--verbose" in cmd_args

    @pytest.mark.asyncio
    async def test_command_includes_resume_when_session_exists(self, mock_process):
        manager = ClaudeCodeManager(claude_command="claude")
        manager.session.session_id = "session-abc"
        on_output = AsyncMock()

        with (
            patch(
                "claudeline.claude_code_manager.asyncio.create_subprocess_exec",
                return_value=mock_process,
            ) as mock_exec,
            patch.object(manager, "_find_claude", return_value="claude"),
        ):
            await manager.execute("test prompt", on_output=on_output)

            cmd_args = mock_exec.call_args[0]
            assert "--resume" in cmd_args
            assert "session-abc" in cmd_args
