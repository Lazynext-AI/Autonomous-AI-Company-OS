"""Page scraping tool — Cloudflare Browser Rendering (headless Chromium on the
worker). Firecrawl remains an optional fallback if its key is set."""

from typing import Any

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)

FIRECRAWL_BASE = "https://api.firecrawl.dev/v1"


async def scrape_url(url: str, max_chars: int = 6000) -> str:
    """Scrape a page's main content. Cloudflare Browser Rendering is primary;
    Firecrawl is used only if the worker scrape is unavailable."""
    settings = get_settings()

    # Primary: Cloudflare Browser Rendering via the worker.
    if settings.cloudflare_api_url and settings.cloudflare_api_token:
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.post(
                    f"{settings.cloudflare_api_url.rstrip('/')}/scrape",
                    headers={
                        "authorization": f"Bearer {settings.cloudflare_api_token}",
                        "content-type": "application/json",
                    },
                    json={"url": url, "max_chars": max_chars},
                )
                if r.status_code == 200:
                    md = r.json().get("markdown", "")
                    if md:
                        return md[:max_chars]
        except Exception as e:
            logger.warning("cloudflare_scrape_failed", url=url, error=str(e))

    # Fallback: Firecrawl (only if a key is set).
    if settings.firecrawl_api_key:
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                r = await client.post(
                    f"{FIRECRAWL_BASE}/scrape",
                    headers={"Authorization": f"Bearer {settings.firecrawl_api_key}", "Content-Type": "application/json"},
                    json={"url": url, "formats": ["markdown"], "onlyMainContent": True},
                )
                if r.status_code == 200:
                    return (r.json().get("data") or {}).get("markdown", "")[:max_chars]
        except Exception as e:
            logger.error("firecrawl_scrape_error", url=url, error=str(e))
    return ""


async def research_topic(query: str, urls: list[str] | None = None, max_results: int = 4) -> str:
    """Serper finds pages → scraper reads them → returns combined research text."""
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
