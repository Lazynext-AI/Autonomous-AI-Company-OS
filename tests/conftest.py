"""Pytest configuration and fixtures."""

import pytest


@pytest.fixture
def anyio_backend() -> str:
    """Use asyncio backend for anyio."""
    return "asyncio"
