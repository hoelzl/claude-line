"""Tests for claudeline.server module."""

import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudeline.server import (
    _format_work_dir,
    handle_cancel,
    handle_reset,
    run_server,
    websocket_endpoint,
)


class TestFormatWorkDir:
    """Test the _format_work_dir helper."""

    def test_short_path_returned_as_is(self):
        # A two-component path (drive + dir on Windows, or /foo on Unix)
        assert _format_work_dir("/home") == "/home"

    def test_long_path_shows_last_two_components(self):
        result = _format_work_dir("/home/user/projects/my-app")
        assert result == ".../projects/my-app"

    def test_three_component_path(self):
        result = _format_work_dir("/home/user/code")
        assert result == ".../user/code"

    def test_root_path(self):
        result = _format_work_dir("/")
        assert result == "/"


class TestHandleCancel:
    """Test that handle_cancel sends auto_dismiss in status messages."""

    @pytest.mark.asyncio
    async def test_cancel_when_running_includes_auto_dismiss(self):
        ws = AsyncMock()
        with patch("claudeline.server.claude_manager") as mock_manager:
            mock_manager.cancel = AsyncMock(return_value=True)
            await handle_cancel(ws)

        ws.send_json.assert_called_once()
        msg = ws.send_json.call_args[0][0]
        assert msg["type"] == "status"
        assert msg["auto_dismiss"] == 2000
        assert "cancelled" in msg["message"].lower()

    @pytest.mark.asyncio
    async def test_cancel_when_not_running_includes_auto_dismiss(self):
        ws = AsyncMock()
        with patch("claudeline.server.claude_manager") as mock_manager:
            mock_manager.cancel = AsyncMock(return_value=False)
            await handle_cancel(ws)

        ws.send_json.assert_called_once()
        msg = ws.send_json.call_args[0][0]
        assert msg["type"] == "status"
        assert msg["auto_dismiss"] == 2000
        assert "nothing" in msg["message"].lower()


class TestHandleReset:
    """Test that handle_reset resets session and sends auto_dismiss."""

    @pytest.mark.asyncio
    async def test_reset_calls_reset_session(self):
        ws = AsyncMock()
        with patch("claudeline.server.claude_manager") as mock_manager:
            mock_manager.reset_session = MagicMock()
            await handle_reset(ws)

            mock_manager.reset_session.assert_called_once()

    @pytest.mark.asyncio
    async def test_reset_status_includes_auto_dismiss(self):
        ws = AsyncMock()
        with patch("claudeline.server.claude_manager") as mock_manager:
            mock_manager.reset_session = MagicMock()
            await handle_reset(ws)

        ws.send_json.assert_called_once()
        msg = ws.send_json.call_args[0][0]
        assert msg["type"] == "status"
        assert msg["auto_dismiss"] == 2000


class TestWebSocketConfig:
    """Test that config message is sent on WebSocket connect."""

    @pytest.mark.asyncio
    async def test_config_sent_on_connect(self):
        ws = AsyncMock()
        # Make receive_text raise disconnect after the config is sent
        ws.receive_text = AsyncMock(side_effect=Exception("disconnect"))

        with patch("claudeline.server.claude_manager") as mock_manager:
            mock_manager.work_dir = "/home/user/projects/my-app"

            with contextlib.suppress(Exception):
                await websocket_endpoint(ws)

        ws.accept.assert_called_once()
        # First send_json call should be the config message
        first_call = ws.send_json.call_args_list[0]
        msg = first_call[0][0]
        assert msg["type"] == "config"
        assert msg["work_dir"] == "/home/user/projects/my-app"
        assert "work_dir_display" in msg


class TestRunServerSsl:
    """Test that run_server passes SSL params to uvicorn correctly."""

    @patch("claudeline.server.uvicorn")
    def test_ssl_params_passed_to_uvicorn_when_set(self, mock_uvicorn):
        run_server(
            host="127.0.0.1",
            port=9999,
            ssl_certfile="/path/cert.pem",
            ssl_keyfile="/path/key.pem",
        )
        mock_uvicorn.run.assert_called_once()
        kwargs = mock_uvicorn.run.call_args
        assert kwargs[1]["ssl_certfile"] == "/path/cert.pem"
        assert kwargs[1]["ssl_keyfile"] == "/path/key.pem"

    @patch("claudeline.server.uvicorn")
    def test_ssl_params_omitted_when_not_set(self, mock_uvicorn):
        run_server(host="127.0.0.1", port=9999)
        mock_uvicorn.run.assert_called_once()
        kwargs = mock_uvicorn.run.call_args
        assert "ssl_certfile" not in kwargs[1]
        assert "ssl_keyfile" not in kwargs[1]

    @patch("claudeline.server.uvicorn")
    def test_ssl_params_omitted_when_only_certfile_set(self, mock_uvicorn):
        run_server(host="127.0.0.1", port=9999, ssl_certfile="/path/cert.pem")
        mock_uvicorn.run.assert_called_once()
        kwargs = mock_uvicorn.run.call_args
        assert "ssl_certfile" not in kwargs[1]
        assert "ssl_keyfile" not in kwargs[1]
