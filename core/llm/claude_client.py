"""Async Claude API client with tiered model selection."""

import asyncio
from typing import Any

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)

CLAUDE_BASE = "https://api.anthropic.com/v1"


class ClaudeClient:
    """Async client for Anthropic Claude API with tiered model selection."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._api_key = (self._settings.anthropic_api_key or "").strip()
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=120.0,
                headers={
                    "x-api-key": self._api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def _url(self) -> str:
        return f"{CLAUDE_BASE}/messages"

    async def _request_with_retry(
        self,
        method: str,
        url: str,
        max_attempts: int = 3,
        **kwargs: Any,
    ) -> httpx.Response:
        client = await self._get_client()
        last_error: Exception | None = None
        for attempt in range(max_attempts):
            try:
                return await client.request(method, url, **kwargs)
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                last_error = e
                wait = 2**attempt
                logger.warning("claude_request_failed", attempt=attempt + 1, wait_seconds=wait, error=str(e))
                await asyncio.sleep(wait)
        raise last_error or RuntimeError("Request failed after retries")

    async def health_check(self) -> bool:
        """Check if Claude API is reachable and key is valid."""
        if not self._api_key:
            return False
        try:
            url = self._url()
            async with httpx.AsyncClient(
                timeout=10.0,
                headers={
                    "x-api-key": self._api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
            ) as client:
                default_model = self._settings.anthropic_model or "claude-sonnet-4-5"
                r = await client.post(
                    url,
                    json={
                        "model": default_model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "Hi"}],
                    },
                )
                if r.status_code == 200:
                    return True
                if r.status_code == 401:
                    logger.error("claude_invalid_api_key")
                    return False
                return False
        except Exception as e:
            logger.error("claude_health_check_failed", error=str(e))
            return False

    async def model_swap(self, new_model: str) -> None:
        """No-op for Claude - model is specified per request."""
        pass

    async def get_loaded_models(self) -> list[str]:
        """Claude uses cloud models - return available models."""
        return ["claude-opus-4-6", "claude-sonnet-4-5", "claude-haiku-4-5"]

    def start_worker(self) -> asyncio.Task:
        """No-op for Claude (no model swap queue needed). Returns dummy task."""
        async def _noop():
            await asyncio.Event().wait()
        return asyncio.create_task(_noop())

    def _build_request(
        self,
        model: str,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
        max_tokens: int = 4096,
    ) -> dict:
        """Build Claude API request."""
        claude_messages = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "system":
                continue
            claude_role = "user" if role == "user" else "assistant"
            claude_messages.append({"role": claude_role, "content": content})

        if not claude_messages or claude_messages[-1].get("role") != "user":
            claude_messages.append({"role": "user", "content": "Respond."})

        default_model = self._settings.anthropic_model or "claude-sonnet-4-5"
        body: dict = {
            "model": model or default_model,
            "max_tokens": max_tokens,
            "messages": claude_messages,
        }
        if system_prompt:
            body["system"] = system_prompt
        return body

    async def chat_completion(
        self,
        model: str,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
        max_tokens: int = 4096,
    ) -> str:
        """Get chat completion from Claude API."""
        if not self._api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set. Add to .env")
        default_model = self._settings.anthropic_model or "claude-sonnet-4-5"
        model = model or default_model
        url = self._url()
        body = self._build_request(model, messages, system_prompt, max_tokens)

        for attempt in range(5):
            try:
                response = await self._request_with_retry("POST", url, json=body)
                if response.status_code == 429:
                    wait = [15, 30, 60, 90, 120][min(attempt, 4)]
                    logger.warning(
                        "claude_rate_limited",
                        attempt=attempt + 1,
                        wait_seconds=wait,
                        hint="Rate limit exceeded. Check console.anthropic.com for limits.",
                    )
                    await asyncio.sleep(wait)
                    continue
                if response.status_code != 200:
                    err = response.text
                    logger.error("claude_api_error", status=response.status_code, body=err[:200])
                    raise RuntimeError(f"Claude API error: {response.status_code} - {err[:200]}")

                data = response.json()
                content_blocks = data.get("content", [])
                if not content_blocks:
                    return ""
                text_block = content_blocks[0]
                if isinstance(text_block, dict) and text_block.get("type") == "text":
                    return text_block.get("text", "")
                return str(content_blocks[0])
            except Exception as e:
                logger.error("claude_chat_failed", model=model, error=str(e))
                raise
        raise RuntimeError(
            "Claude API: rate limit (429) exceeded after 5 retries. "
            "Check quota at console.anthropic.com or reduce CEO_LOOP_INTERVAL / CTO_LOOP_INTERVAL."
        )
