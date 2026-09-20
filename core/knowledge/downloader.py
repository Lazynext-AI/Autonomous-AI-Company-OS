"""Knowledge downloader - OpenLibrary and arXiv."""

import asyncio
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


@dataclass
class BookResult:
    """OpenLibrary book result."""

    title: str
    author: str
    url: str
    cover_url: str = ""


@dataclass
class PaperResult:
    """arXiv paper result."""

    title: str
    authors: str
    pdf_url: str
    abstract: str = ""


@dataclass
class DownloadResult:
    """Download result."""

    success: bool
    filepath: str = ""
    source: str = ""
    title: str = ""
    error: str = ""


class KnowledgeDownloader:
    """Download books and papers for knowledge base."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._kb_dir = Path(self._settings.knowledge_base_dir)
        self._kb_dir.mkdir(parents=True, exist_ok=True)
        self._history_key = "knowledge_download_history"

    async def search_openlibrary(self, query: str) -> list[BookResult]:
        """Search OpenLibrary for books."""
        try:
            url = f"https://openlibrary.org/search.json?q={quote_plus(query)}&limit=10"
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get(url)
                if r.status_code != 200:
                    return []
                data = r.json()
                docs = data.get("docs", [])
                results = []
                for d in docs[:5]:
                    title = d.get("title", "Unknown")
                    author = d.get("author_name", ["Unknown"])
                    author = author[0] if isinstance(author, list) else author
                    olid = d.get("cover_edition_key") or d.get("edition_key", [""])[0]
                    cover = f"https://covers.openlibrary.org/b/olid/{olid}-M.jpg" if olid else ""
                    results.append(BookResult(
                        title=title,
                        author=author,
                        url=f"https://openlibrary.org/works/{d.get('key', '').replace('/works/', '')}",
                        cover_url=cover,
                    ))
                return results
        except Exception as e:
            logger.error("openlibrary_search_failed", query=query, error=str(e))
            return []

    async def search_arxiv(self, query: str) -> list[PaperResult]:
        """Search arXiv for papers."""
        try:
            url = f"http://export.arxiv.org/api/query?search_query=all:{quote_plus(query)}&start=0&max_results=10"
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get(url)
                if r.status_code != 200:
                    return []
                import xml.etree.ElementTree as ET
                root = ET.fromstring(r.text)
                ns = {"atom": "http://www.w3.org/2005/Atom"}
                entries = root.findall("atom:entry", ns)
                results = []
                for e in entries:
                    title_el = e.find("atom:title", ns) or e.find("title")
                    title = (title_el.text or "Unknown").strip().replace("\n", " ")
                    pdf_url = ""
                    for link in e.findall("atom:link", ns) or e.findall("link"):
                        if link.get("title") == "pdf" or "pdf" in (link.get("href") or ""):
                            pdf_url = link.get("href", "")
                            break
                    if not pdf_url:
                        id_el = e.find("atom:id", ns) or e.find("id")
                        if id_el is not None and id_el.text:
                            arxiv_id = id_el.text.split("/")[-1]
                            pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
                    authors = e.find("atom:author", ns)
                    author_str = authors.find("atom:name", ns).text if authors is not None else "Unknown"
                    abstract_el = e.find("atom:summary", ns) or e.find("summary")
                    abstract = abstract_el.text[:200] if abstract_el is not None and abstract_el.text else ""
                    results.append(PaperResult(
                        title=title,
                        authors=author_str,
                        pdf_url=pdf_url,
                        abstract=abstract,
                    ))
                return results
        except Exception as e:
            logger.error("arxiv_search_failed", query=query, error=str(e))
            return []

    async def download_pdf(self, url: str, save_path: str) -> bool:
        """Download PDF from URL."""
        try:
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                r = await client.get(url)
                if r.status_code != 200:
                    return False
                Path(save_path).parent.mkdir(parents=True, exist_ok=True)
                with open(save_path, "wb") as f:
                    f.write(r.content)
                return True
        except Exception as e:
            logger.error("download_pdf_failed", url=url, error=str(e))
            return False

    async def find_and_download(
        self,
        topic: str,
        category: str,
        ingestion_callback=None,
    ) -> DownloadResult:
        """Search both sources, download best match, ingest. ingestion_callback(filepath, category) -> None."""
        papers = await self.search_arxiv(topic)
        books = await self.search_openlibrary(topic)

        best_url = None
        best_title = ""
        source = ""

        if papers:
            p = papers[0]
            if p.pdf_url:
                best_url = p.pdf_url
                best_title = p.title
                source = "arxiv"
        if not best_url and books:
            best_title = books[0].title
            source = "openlibrary"
            best_url = None  # OpenLibrary PDFs need different handling

        if not best_url:
            return DownloadResult(success=False, error="No PDF found", title=best_title)

        safe_name = re.sub(r"[^\w\-.]", "_", best_title)[:80] + ".pdf"
        subdir = self._kb_dir / category
        subdir.mkdir(parents=True, exist_ok=True)
        filepath = str(subdir / safe_name)

        ok = await self.download_pdf(best_url, filepath)
        if not ok:
            return DownloadResult(success=False, error="Download failed", title=best_title)

        if ingestion_callback:
            try:
                result = ingestion_callback(filepath, category)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                logger.error("ingestion_callback_failed", error=str(e))
        else:
            try:
                from core.knowledge.ingestion import KnowledgeIngestion
                ingestion = KnowledgeIngestion()
                await ingestion.ingest_pdf(filepath, category)
            except Exception as e:
                logger.error("auto_ingestion_failed", error=str(e))

        return DownloadResult(success=True, filepath=filepath, source=source, title=best_title)

    async def get_download_history(self) -> list[dict]:
        """Get download history from D1."""
        try:
            from core.cloudflare_client import CloudflareClient
            client = CloudflareClient()
            rows = await client.aquery(
                "SELECT payload FROM download_history ORDER BY id DESC LIMIT 100"
            )
            history = []
            for row in rows:
                try:
                    import json
                    history.append(json.loads(row.get("payload", "{}")))
                except Exception:
                    pass
            return history
        except Exception:
            return []
