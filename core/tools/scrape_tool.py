"""Firecrawl scraping tool — deep page content for agent research."""

from typing import Any

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)

FIRECRAWL_BASE = "https://api.firecrawl.dev/v1"


async def scrape_url(url: str, max_chars: int = 6000) -> str:
    """Scrape a page's main content as markdown via Firecrawl."""
    key = get_settings().firecrawl_api_key
    if not key:
        logger.warning("firecrawl_no_key")
        return ""
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            r = await client.post(
                f"{FIRECRAWL_BASE}/scrape",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"url": url, "formats": ["markdown"], "onlyMainContent": True},
            )
            if r.status_code != 200:
                logger.error("firecrawl_scrape_failed", url=url, status=r.status_code)
                return ""
            md = (r.json().get("data") or {}).get("markdown", "")
            return md[:max_chars]
    except Exception as e:
        logger.error("firecrawl_scrape_error", url=url, error=str(e))
        return ""


async def research_topic(query: str, urls: list[str] | None = None, max_results: int = 4) -> str:
    """Serper finds pages → Firecrawl reads them → returns combined research text."""
    from core.tools.search_tool import search_web

    if urls is None:
        hits = await search_web(query, max_results)
        urls = [h["url"] for h in hits if h.get("url")]

    sections = []
    for u in urls[:max_results]:
        content = await scrape_url(u)
        if content:
            sections.append(f"### {u}\n{content}")
    return "\n\n".join(sections)
