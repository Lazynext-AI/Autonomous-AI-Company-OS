"""Web search tool — Serper.dev (real Google results). The only search path."""

from typing import Any

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


async def search_web(query: str, max_results: int = 10) -> list[dict[str, Any]]:
    """Search via Serper.dev — real Google results for agent research."""
    key = get_settings().serper_api_key
    if not key:
        return []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": key, "Content-Type": "application/json"},
                json={"q": query, "num": max_results},
            )
            if r.status_code != 200:
                return []
            organic = r.json().get("organic", [])
            return [
                {"url": i.get("link", ""), "title": i.get("title", ""), "snippet": i.get("snippet", "")}
                for i in organic[:max_results]
            ]
    except Exception as e:
        logger.error("serper_search_failed", query=query, error=str(e))
        return []
