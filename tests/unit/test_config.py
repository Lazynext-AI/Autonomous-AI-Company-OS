"""Unit tests for core config."""

import pytest

from core.config import MODEL_REGISTRY, get_model_for_role, get_settings


def test_get_settings() -> None:
    """Settings loads from environment."""
    settings = get_settings()
    assert settings.redis_url.startswith("redis://")
    assert settings.anthropic_model


def test_get_model_for_role() -> None:
    """Model registry returns correct tiered Claude models for each role."""
    assert get_model_for_role("ceo") == "claude-sonnet-4-5"
    assert get_model_for_role("cto") == "claude-sonnet-4-5"
    assert get_model_for_role("backend") == "claude-sonnet-4-5"
    assert get_model_for_role("qa") == "claude-sonnet-4-5"
    assert get_model_for_role("marketing") == "claude-haiku-4-5"
    assert get_model_for_role("unknown_role") == "claude-sonnet-4-5"


def test_model_registry_has_all_roles() -> None:
    """All expected roles are in registry."""
    expected = {
        "ceo", "cto", "backend", "frontend", "fullstack", "devops", "qa",
        "marketing", "sales", "customer_success", "hr", "knowledge", "finance",
    }
    assert set(MODEL_REGISTRY.keys()) == expected
