"""Knowledge downloader — sources the knowledge base from the platform's own
web tools (Serper search + Cloudflare Browser Rendering scrape) instead of
external catalogs like OpenLibrary/arXiv. A topic is researched live, the best
source is scraped to markdown, and the content is ingested for RAG."""

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


@dataclass
class DownloadResult:
    """Result of a knowledge acquisition."""

    success: bool
    filepath: str = ""
    source: str = ""
    title: str = ""
    error: str = ""


class KnowledgeDownloader:
    """Research a topic with the company's own search+scrape tools and ingest
    the result into the knowledge base (Vectorize + D1)."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._kb_dir = Path(self._settings.knowledge_base_dir)
        self._kb_dir.mkdir(parents=True, exist_ok=True)

    async def find_and_download(
        self,
        topic: str,
        category: str,
        ingestion_callback=None,
    ) -> DownloadResult:
        """Research `topic` via Serper, scrape the best source via Cloudflare
        Browser Rendering, save it as markdown, and ingest it.
        ingestion_callback(filepath, category) -> None."""
        from core.tools.scrape_tool import scrape_url
        from core.tools.search_tool import search_web

        # Find relevant pages on the topic.
        results = await search_web(topic, max_results=5)
        if not results:
            return DownloadResult(success=False, error="No sources found", title=topic)

        # Scrape the top sources until one yields usable content.
        title = ""
        url = ""
        content = ""
        for r in results:
            u = r.get("url", "")
            if not u:
                continue
            text = await scrape_url(u)
            if text and len(text) > 400:
                title = r.get("title") or u
                url = u
                content = text
                break

        if not content:
            return DownloadResult(success=False, error="No usable content scraped", title=title or topic)

        # Persist as markdown — ingestion handles .md as a single page.
        safe = re.sub(r"[^\w\-.]", "_", (title or topic))[:80]
        subdir = self._kb_dir / category
        subdir.mkdir(parents=True, exist_ok=True)
        filepath = str(subdir / f"{safe}.md")
        header = f"# {title}\n\nSource: {url}\nTopic: {topic}\n\n---\n\n"
        Path(filepath).write_text(header + content, encoding="utf-8")

        if ingestion_callback:
            try:
                res = ingestion_callback(filepath, category)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                logger.error("ingestion_callback_failed", error=str(e))
        else:
            try:
                from core.knowledge.ingestion import KnowledgeIngestion
                await KnowledgeIngestion().ingest_pdf(filepath, category)
            except Exception as e:
                logger.error("auto_ingestion_failed", error=str(e))

        return DownloadResult(success=True, filepath=filepath, source="web", title=title)

    async def get_download_history(self) -> list[dict]:
        """Get download history from D1."""
        try:
            import json
            from core.cloudflare_client import CloudflareClient
            client = CloudflareClient()
            rows = await client.aquery(
                "SELECT payload FROM download_history ORDER BY id DESC LIMIT 100"
            )
            history = []
            for row in rows:
                try:
                    history.append(json.loads(row.get("payload", "{}")))
                except Exception:
                    pass
            return history
        except Exception:
            return []
