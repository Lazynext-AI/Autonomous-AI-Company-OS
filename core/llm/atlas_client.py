"""Async Atlas Cloud client with tiered model selection (OpenAI-compatible API)."""

import asyncio
from typing import Any

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


class AtlasClient:
    """Async client for Atlas Cloud (https://api.atlascloud.ai/v1)."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._api_key = (self._settings.atlas_api_key or "").strip()
        self._base_url = (self._settings.atlas_base_url or "https://api.atlascloud.ai/v1").rstrip("/")
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=120.0,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "content-type": "application/json",
                },
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def _url(self) -> str:
        return f"{self._base_url}/chat/completions"

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
                logger.warning("atlas_request_failed", attempt=attempt + 1, wait_seconds=wait, error=str(e))
                await asyncio.sleep(wait)
        raise last_error or RuntimeError("Request failed after retries")

    async def health_check(self) -> bool:
        """Check if Atlas Cloud API is reachable and key is valid."""
        if not self._api_key:
            return False
        try:
            async with httpx.AsyncClient(
                timeout=10.0,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "content-type": "application/json",
                },
            ) as client:
                r = await client.post(
                    self._url(),
                    json={
                        "model": self._settings.atlas_model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "Hi"}],
                    },
                )
                if r.status_code == 200:
                    return True
                if r.status_code == 401:
                    logger.error("atlas_invalid_api_key")
                    return False
                return False
        except Exception as e:
            logger.error("atlas_health_check_failed", error=str(e))
            return False

    async def model_swap(self, new_model: str) -> None:
        """No-op - model is specified per request."""
        pass

    async def get_loaded_models(self) -> list[str]:
        """Return available model IDs from Atlas Cloud."""
        try:
            client = await self._get_client()
            r = await client.get(f"{self._base_url}/models")
            if r.status_code == 200:
                data = r.json()
                models = data.get("data", data if isinstance(data, list) else [])
                return [m.get("id", "") for m in models if isinstance(m, dict)]
        except Exception as e:
            logger.error("atlas_models_fetch_failed", error=str(e))
        return []

    def start_worker(self) -> asyncio.Task:
        """No-op (no model swap queue needed). Returns dummy task."""
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
        """Build OpenAI-compatible chat completion request."""
        api_messages = []
        if system_prompt:
            api_messages.append({"role": "system", "content": system_prompt})
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "system":
                api_messages.append({"role": "system", "content": content})
            else:
                api_messages.append({
                    "role": "user" if role == "user" else "assistant",
                    "content": content,
                })

        if not api_messages or api_messages[-1].get("role") != "user":
            api_messages.append({"role": "user", "content": "Respond."})

        return {
            "model": model or self._settings.atlas_model,
            "max_tokens": max_tokens,
            "messages": api_messages,
        }

    async def chat_completion(
        self,
        model: str,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
        max_tokens: int = 4096,
    ) -> str:
        """Get chat completion — Cloudflare Workers AI is the primary brain;
        Atlas Cloud is an optional fallback if configured."""
        if self._fallback_available():
            try:
                return await self._workers_ai_fallback(messages, system_prompt, max_tokens)
            except Exception as e:
                logger.warning("workers_ai_primary_failed", error=str(e))
                if not self._api_key:
                    raise
        if not self._api_key:
            raise RuntimeError("No LLM backend: Workers AI unavailable and ATLASCLOUD_API_KEY not set.")
        model = model or self._settings.atlas_model
        url = self._url()
        body = self._build_request(model, messages, system_prompt, max_tokens)

        for attempt in range(5):
            try:
                response = await self._request_with_retry("POST", url, json=body)
                if response.status_code == 429:
                    wait = [15, 30, 60, 90, 120][min(attempt, 4)]
                    logger.warning(
                        "atlas_rate_limited",
                        attempt=attempt + 1,
                        wait_seconds=wait,
                        hint="Rate limit exceeded. Check atlascloud.ai for limits.",
                    )
                    await asyncio.sleep(wait)
                    continue
                if response.status_code != 200:
                    err = response.text
                    logger.error("atlas_api_error", status=response.status_code, body=err[:200])
                    raise RuntimeError(f"Atlas API error: {response.status_code} - {err[:200]}")

                data = response.json()
                # Atlas returns error envelopes (e.g. {"code":402,"msg":"insufficient
                # balance"}) — sometimes with HTTP 200. Treat those as failures.
                if data.get("code") and data.get("code") != 200:
                    raise RuntimeError(f"Atlas error: {data.get('code')} {data.get('msg')}")
                choices = data.get("choices", [])
                if not choices:
                    if self._fallback_available():
                        logger.warning("atlas_empty_choices_fallback")
                        return await self._workers_ai_fallback(messages, system_prompt, max_tokens)
                    return ""
                message = choices[0].get("message", {})
                content = message.get("content", "")
                if isinstance(content, str):
                    return content
                if isinstance(content, list):
                    return "".join(
                        b.get("text", "") for b in content if isinstance(b, dict)
                    )
                return str(content)
            except Exception as e:
                logger.error("atlas_chat_failed", model=model, error=str(e))
                # Stand-in brain: if Atlas is unfunded/erroring, fall back to
                # the company Worker's /agent/generate (Workers AI Llama) so
                # `make dev` still runs the real agent loop. Delete this once
                # Atlas has credits.
                if self._fallback_available():
                    logger.warning("atlas_fallback_to_workers_ai")
                    return await self._workers_ai_fallback(messages, system_prompt, max_tokens)
                raise
        raise RuntimeError(
            "Atlas Cloud: rate limit (429) exceeded after 5 retries. "
            "Check quota at atlascloud.ai or reduce CEO_LOOP_INTERVAL / CTO_LOOP_INTERVAL."
        )

    def _fallback_available(self) -> bool:
        return bool(
            self._settings.cloudflare_api_url and self._settings.cloudflare_api_token
        )

    async def _workers_ai_fallback(
        self,
        messages: list[dict[str, str]],
        system_prompt: str | None,
        max_tokens: int,
    ) -> str:
        """Call the company Worker's /agent/generate (Workers AI Llama) as a
        stand-in brain until Atlas Cloud is funded."""
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
            raise RuntimeError(f"workers-ai fallback failed: {r.status_code} {r.text[:200]}")
        return r.json().get("text", "")
