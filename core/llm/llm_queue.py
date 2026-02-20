"""LLM request queue - batches by model to reduce swap overhead."""

import asyncio
from dataclasses import dataclass, field
from typing import Any

import structlog

from core.llm.ollama_client import OllamaClient

logger = structlog.get_logger(__name__)


@dataclass
class LLMRequest:
    """Single LLM request in queue."""

    model: str
    messages: list[dict[str, str]]
    system_prompt: str | None
    future: asyncio.Future


class LLMQueue:
    """Queue that processes LLM requests, minimizing model swaps."""

    def __init__(self, ollama_client: OllamaClient) -> None:
        self._client = ollama_client
        self._queue: asyncio.Queue[LLMRequest] = asyncio.Queue()
        self._worker_task: asyncio.Task | None = None

    def start_worker(self) -> asyncio.Task:
        """Start the background worker. Returns the task."""
        if self._worker_task and not self._worker_task.done():
            return self._worker_task
        self._worker_task = asyncio.create_task(self._run_worker())
        return self._worker_task

    async def _run_worker(self) -> None:
        """Process requests from queue. Batches by model implicitly."""
        last_model: str | None = None
        while True:
            try:
                request = await self._queue.get()
                if request is None:
                    break
                try:
                    result = await self._client.chat_completion(
                        request.model,
                        request.messages,
                        system_prompt=request.system_prompt,
                    )
                    if not request.future.done():
                        request.future.set_result(result)
                except Exception as e:
                    if not request.future.done():
                        request.future.set_exception(e)
                    logger.error("llm_queue_request_failed", model=request.model, error=str(e))
                finally:
                    self._queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("llm_queue_worker_error", error=str(e))

    async def submit(
        self,
        model: str,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
    ) -> str:
        """Submit request to queue, await and return result."""
        future: asyncio.Future = asyncio.get_event_loop().create_future()
        await self._queue.put(LLMRequest(model, messages, system_prompt, future))
        return await future

    async def stop(self) -> None:
        """Stop the worker."""
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass


class QueuedOllamaClient:
    """Ollama client that routes through LLM queue."""

    def __init__(self) -> None:
        self._raw = OllamaClient()
        self._queue = LLMQueue(self._raw)

    def start_worker(self) -> asyncio.Task:
        return self._queue.start_worker()

    async def chat_completion(
        self,
        model: str,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
    ) -> str:
        return await self._queue.submit(model, messages, system_prompt)

    async def model_swap(self, new_model: str) -> None:
        await self._raw.model_swap(new_model)

    async def health_check(self) -> bool:
        return await self._raw.health_check()

    async def get_loaded_models(self) -> list[str]:
        return await self._raw.get_loaded_models()

    async def close(self) -> None:
        await self._queue.stop()
        await self._raw.close()
