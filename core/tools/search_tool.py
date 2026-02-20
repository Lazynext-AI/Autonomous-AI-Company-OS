"""DuckDuckGo search tool - free, no API key."""

import re
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)


async def search_duckduckgo(query: str, max_results: int = 10) -> list[dict[str, Any]]:
    """Search DuckDuckGo HTML and parse results."""
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
