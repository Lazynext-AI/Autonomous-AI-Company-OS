"""LLM client — Cloudflare Workers AI (Llama-3.3-70b) via the company worker.

This module keeps the `AtlasClient` name for backward compatibility with the
agents, but the backend is now entirely Cloudflare Workers AI. No Atlas Cloud."""

import asyncio
from typing import Any

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)

WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"


class AtlasClient:
    """LLM client backed by Cloudflare Workers AI via the company worker."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=120.0)
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def health_check(self) -> bool:
        """Check the Workers AI brain is reachable via the worker."""
        if not (self._settings.cloudflare_api_url and self._settings.cloudflare_api_token):
            return False
        try:
            client = await self._get_client()
            r = await client.post(
                f"{self._settings.cloudflare_api_url.rstrip('/')}/agent/generate",
                headers={"authorization": f"Bearer {self._settings.cloudflare_api_token}"},
                json={"system": "", "prompt": "Hi", "max_tokens": 1},
            )
            return r.status_code == 200
        except Exception as e:
            logger.error("workers_ai_health_check_failed", error=str(e))
            return False

    async def model_swap(self, new_model: str) -> None:
        """No-op — Workers AI model is fixed per worker route."""

    async def get_loaded_models(self) -> list[str]:
        """Return the Workers AI model in use."""
        return [WORKERS_AI_MODEL]

    def start_worker(self) -> asyncio.Task:
        """No-op — no model worker needed. Returns a dummy task."""
        async def _noop():
            await asyncio.Event().wait()
        return asyncio.create_task(_noop())

    async def chat_completion(
        self,
        model: str,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
        max_tokens: int = 4096,
    ) -> str:
        """Chat completion via Cloudflare Workers AI (worker /agent/generate)."""
        return await self._generate(messages, system_prompt, max_tokens)

    async def _generate(
        self,
        messages: list[dict[str, str]],
        system_prompt: str | None,
        max_tokens: int,
    ) -> str:
        """Call the worker's /agent/generate — Workers AI Llama-3.3-70b."""
        if not (self._settings.cloudflare_api_url and self._settings.cloudflare_api_token):
            raise RuntimeError(
                "Workers AI unreachable: set CLOUDFLARE_API_URL and CLOUDFLARE_API_TOKEN in .env"
            )
        client = await self._get_client()
        prompt = "\n".join(
            m.get("content", "") for m in messages if m.get("role") != "system"
        ).strip() or "Respond."
        r = await client.post(
            f"{self._settings.cloudflare_api_url.rstrip('/')}/agent/generate",
            headers={"authorization": f"Bearer {self._settings.cloudflare_api_token}"},
            json={
                "system": system_prompt or "You are an agent inside an autonomous AI company.",
                "prompt": prompt,
                "max_tokens": min(max_tokens, 2048),
            },
        )
        if r.status_code != 200:
            raise RuntimeError(f"workers-ai generate failed: {r.status_code} {r.text[:200]}")
        return r.json().get("text", "")
