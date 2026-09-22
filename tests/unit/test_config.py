"""Unit tests for core config."""

import pytest

from core.config import MODEL_REGISTRY, get_model_for_role, get_settings

WORKERS_AI = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"


def test_get_settings() -> None:
    """Settings loads from environment."""
    settings = get_settings()
    assert settings.llm_model.startswith("@cf/")


def test_get_model_for_role() -> None:
    """Model registry returns the Workers AI model for each role."""
    for role in ("ceo", "cto", "backend", "qa", "marketing", "unknown_role"):
        assert get_model_for_role(role) == WORKERS_AI


def test_model_registry_has_all_roles() -> None:
    """All expected roles are in registry."""
    expected = {
        "ceo", "cto", "backend", "frontend", "fullstack", "devops", "qa",
        "code_review", "marketing", "sales", "customer_success", "hr",
        "knowledge", "finance",
    }
    assert set(MODEL_REGISTRY.keys()) == expected
