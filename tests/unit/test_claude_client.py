"""Unit tests for Claude client."""

import pytest

from core.llm.claude_client import ClaudeClient


@pytest.mark.asyncio
async def test_health_check_no_key() -> None:
    """Health check returns False when API key not set."""
    client = ClaudeClient()
    client._api_key = ""
    assert await client.health_check() is False


@pytest.mark.asyncio
async def test_get_loaded_models() -> None:
    """Get loaded models returns Claude models."""
    client = ClaudeClient()
    models = await client.get_loaded_models()
    assert "claude-opus-4-6" in models
    assert "claude-sonnet-4-5" in models
    assert "claude-haiku-4-5" in models


@pytest.mark.asyncio
async def test_model_swap_noop() -> None:
    """Model swap is no-op for Claude."""
    client = ClaudeClient()
    await client.model_swap("any-model")
