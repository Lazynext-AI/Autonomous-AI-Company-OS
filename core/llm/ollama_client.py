"""Async Ollama client with model swapping and retry logic."""

import asyncio
import json
from typing import Any, AsyncGenerator

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


class OllamaClient:
    """Async client for Ollama API with retries and model swapping."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._base_url = self._settings.ollama_base_url.rstrip("/")
        self._current_model: str | None = None
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=120.0,
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def _request_with_retry(
        self,
        method: str,
        path: str,
        max_attempts: int = 3,
        **kwargs: Any,
    ) -> httpx.Response:
        """Execute request with exponential backoff retry."""
        client = await self._get_client()
        last_error: Exception | None = None

        for attempt in range(max_attempts):
            try:
                response = await client.request(method, path, **kwargs)
                return response
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                last_error = e
                wait = 2**attempt
                logger.warning(
                    "ollama_request_failed",
                    attempt=attempt + 1,
                    max_attempts=max_attempts,
                    wait_seconds=wait,
                    error=str(e),
                )
                await asyncio.sleep(wait)

        raise last_error or RuntimeError("Request failed after retries")

    async def health_check(self) -> bool:
        """Check if Ollama is running and responsive."""
        try:
            response = await self._request_with_retry("GET", "/api/tags")
            return response.status_code == 200
        except Exception as e:
            logger.error("ollama_health_check_failed", error=str(e))
            return False

    async def get_loaded_models(self) -> list[str]:
        """Get list of currently loaded models."""
        try:
            response = await self._request_with_retry("GET", "/api/ps")
            if response.status_code != 200:
                return []
            data = response.json()
            return [m.get("name", "") for m in data.get("models", []) if m.get("name")]
        except Exception as e:
            logger.error("ollama_get_loaded_models_failed", error=str(e))
            return []

    async def model_swap(self, new_model: str) -> None:
        """Swap to a new model, unloading current and loading new if needed."""
        if self._current_model == new_model:
            return
        try:
            models_response = await self._request_with_retry("GET", "/api/tags")
            if models_response.status_code != 200:
                raise RuntimeError("Could not fetch model list")

            data = models_response.json()
            available = {m.get("name", "") for m in data.get("models", [])}
            model_found = any(
                new_model in m or m.startswith(new_model.split(":")[0])
                for m in available
            )

            if not model_found:
                logger.info("ollama_pulling_model", model=new_model)
                pull_response = await self._request_with_retry(
                    "POST",
                    "/api/pull",
                    json={"name": new_model},
                )
                if pull_response.status_code != 200:
                    raise RuntimeError(f"Failed to pull model {new_model}")

                # Poll until pull complete
                for _ in range(60):
                    await asyncio.sleep(2)
                    models_resp = await self._request_with_retry("GET", "/api/tags")
                    models_data = models_resp.json()
                    if any(
                        new_model in m.get("name", "")
                        for m in models_data.get("models", [])
                    ):
                        break

            # Ollama loads new model on demand; previous model stays in memory
            # until another model is requested (single model at a time on M3)
            self._current_model = new_model
            logger.info("ollama_model_swapped", model=new_model)

        except Exception as e:
            logger.error("ollama_model_swap_failed", model=new_model, error=str(e))
            raise

    async def chat_completion(
        self,
        model: str,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
    ) -> str:
        """Get chat completion from Ollama."""
        await self.model_swap(model)

        full_messages = []
        if system_prompt:
            full_messages.append({"role": "system", "content": system_prompt})
        full_messages.extend(messages)

        try:
            response = await self._request_with_retry(
                "POST",
                "/api/chat",
                json={
                    "model": model,
                    "messages": full_messages,
                    "stream": False,
                },
            )
            if response.status_code != 200:
                raise RuntimeError(f"Ollama API error: {response.status_code}")

            data = response.json()
            message = data.get("message", {})
            return message.get("content", "")
        except Exception as e:
            logger.error(
                "ollama_chat_completion_failed",
                model=model,
                error=str(e),
            )
            raise

    async def stream_completion(
        self,
        model: str,
        messages: list[dict[str, str]],
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion from Ollama."""
        await self.model_swap(model)

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{self._base_url}/api/chat",
                    json={
                        "model": model,
                        "messages": messages,
                        "stream": True,
                    },
                ) as response:
                    if response.status_code != 200:
                        raise RuntimeError(f"Ollama API error: {response.status_code}")

                    async for line in response.aiter_lines():
                        if line.strip():
                            try:
                                data = json.loads(line)
                                content = data.get("message", {}).get("content", "")
                                if content:
                                    yield content
                            except json.JSONDecodeError:
                                continue
        except Exception as e:
            logger.error("ollama_stream_failed", model=model, error=str(e))
            raise
