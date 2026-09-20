"""Unit tests for core config."""

import pytest

from core.config import MODEL_REGISTRY, get_model_for_role, get_settings


def test_get_settings() -> None:
    """Settings loads from environment."""
    settings = get_settings()
    assert settings.atlas_base_url.startswith("https://")
    assert settings.atlas_model


def test_get_model_for_role() -> None:
    """Model registry returns correct tiered models for each role."""
    assert get_model_for_role("ceo") == "deepseek-ai/DeepSeek-V3.1-Terminus"
    assert get_model_for_role("cto") == "deepseek-ai/DeepSeek-V3.1-Terminus"
    assert get_model_for_role("backend") == "deepseek-ai/DeepSeek-V3.1-Terminus"
    assert get_model_for_role("qa") == "deepseek-ai/DeepSeek-V3.1-Terminus"
    assert get_model_for_role("marketing") == "deepseek-ai/deepseek-v4-flash"
    assert get_model_for_role("unknown_role") == "deepseek-ai/DeepSeek-V3.1-Terminus"


def test_model_registry_has_all_roles() -> None:
    """All expected roles are in registry."""
    expected = {
        "ceo", "cto", "backend", "frontend", "fullstack", "devops", "qa",
        "code_review", "marketing", "sales", "customer_success", "hr",
        "knowledge", "finance",
    }
    assert set(MODEL_REGISTRY.keys()) == expected
