"""Tests for claudeline.text_cleanup module."""

import pytest

from claudeline.text_cleanup import cleanup_text


class TestCleanupTextDisabled:
    """Test cleanup_text when cleanup is disabled (default)."""

    @pytest.mark.asyncio
    async def test_returns_original_text_when_disabled(self):
        result = await cleanup_text("hello world")
        assert result["text"] == "hello world"

    @pytest.mark.asyncio
    async def test_returns_original_in_original_field(self):
        result = await cleanup_text("some text")
        assert result["original"] == "some text"

    @pytest.mark.asyncio
    async def test_reports_success(self):
        result = await cleanup_text("test input")
        assert result["success"] is True

    @pytest.mark.asyncio
    async def test_reports_skipped(self):
        result = await cleanup_text("test input")
        assert result["skipped"] is True

    @pytest.mark.asyncio
    async def test_handles_empty_string(self):
        result = await cleanup_text("")
        assert result["text"] == ""
        assert result["success"] is True
