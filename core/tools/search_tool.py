"""Web search tool — Serper.dev (real Google results)."""

import re
from typing import Any

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


async def search_web(query: str, max_results: int = 10) -> list[dict[str, Any]]:
    """Search via Serper.dev — real Google results for agent research."""
    key = get_settings().serper_api_key
    if not key:
        return await _search_duckduckgo(query, max_results)
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


async def _search_duckduckgo(query: str, max_results: int = 10) -> list[dict[str, Any]]:
    """DuckDuckGo HTML fallback when SERPER_API_KEY is unset."""
    try:
        url = "https://html.duckduckgo.com/html/"
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(url, data={"q": query})
            if r.status_code != 200:
                return []
            results = []
            result_blocks = re.split(r'result results_links', r.text)
            for block in result_blocks[1 : max_results + 1]:
                title_match = re.search(r'result__a[^>]*href="([^"]+)"[^>]*>([^<]+)<', block)
                snippet_match = re.search(r'result__snippet[^>]*>([^<]+)<', block)
                if title_match:
                    results.append({
                        "url": title_match.group(1),
                        "title": title_match.group(2).strip(),
                        "snippet": snippet_match.group(1).strip() if snippet_match else "",
                    })
            return results
    except Exception as e:
        logger.error("duckduckgo_search_failed", query=query, error=str(e))
        return []


# Backwards-compatible alias — now routes through Serper when configured.
async def search_duckduckgo(query: str, max_results: int = 10) -> list[dict[str, Any]]:
    return await search_web(query, max_results)
