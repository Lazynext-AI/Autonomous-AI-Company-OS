"""Knowledge ingestion pipeline - PDF to Vectorize + D1 chunk store."""

import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)

CHUNK_CHARS = 1800  # ~450 tokens, within all-MiniLM-L6-v2 limits
CHUNK_OVERLAP = 200


def _split_text(text: str, chunk_size: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks on word/sentence boundaries."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= chunk_size:
        return [text] if text else []
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        if end < len(text):
            boundary = max(text.rfind(". ", start, end), text.rfind(" ", start, end))
            if boundary > start:
                end = boundary + 1
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end - overlap if end - overlap > start else end
    return chunks


def _read_pdf_pages(filepath: str) -> list[tuple[int, str]]:
    """Extract (page_number, text) from a PDF using pypdf."""
    from pypdf import PdfReader

    reader = PdfReader(filepath)
    return [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]


def _read_pages(filepath: str) -> list[tuple[int, str]]:
    """Read pages from PDF, or treat text/markdown files as a single page."""
    if filepath.lower().endswith((".md", ".txt")):
        return [(1, Path(filepath).read_text(encoding="utf-8", errors="replace"))]
    return _read_pdf_pages(filepath)


class KnowledgeIngestion:
    """Ingest PDFs into Vectorize (embeddings) and D1 knowledge_chunks (text)."""

    def __init__(self) -> None:
        self._settings = get_settings()

    def _get_client(self):
        from core.cloudflare_client import CloudflareClient
        return CloudflareClient()

    async def ingest_pdf(self, filepath: str, category: str) -> int:
        """Ingest single document (PDF or .md/.txt). Returns chunk count."""
        try:
            from core.llm.local_embedding import get_embeddings

            client = self._get_client()
            if not client.is_configured():
                raise RuntimeError("Cloudflare not configured - set CLOUDFLARE_API_URL and CLOUDFLARE_API_TOKEN")

            filename = os.path.basename(filepath)
            ingested_at = datetime.now(timezone.utc).isoformat()
            pages = _read_pages(filepath)

            chunks: list[dict[str, Any]] = []
            for page_number, page_text in pages:
                for chunk_text in _split_text(page_text):
                    chunks.append({
                        "id": str(uuid.uuid4()),
                        "filename": filename,
                        "category": category,
                        "page_number": page_number,
                        "content": chunk_text,
                    })

            if not chunks:
                return 0

            embeddings = get_embeddings([c["content"] for c in chunks])

            vectors = [
                {
                    "id": c["id"],
                    "values": emb,
                    "metadata": {
                        "filename": c["filename"],
                        "category": c["category"],
                        "page_number": c["page_number"],
                        "chunk_index": i,
                    },
                }
                for i, (c, emb) in enumerate(zip(chunks, embeddings))
            ]
            await client.vectorize_upsert(vectors)

            rows = [
                (
                    "INSERT INTO knowledge_chunks (id, filename, category, chunk_index, page_number, content, ingested_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [c["id"], c["filename"], c["category"], i, c["page_number"], c["content"], ingested_at],
                )
                for i, c in enumerate(chunks)
            ]
            await client.abatch(rows)

            return len(chunks)
        except ImportError as e:
            logger.error("ingestion_import_failed", error=str(e))
            raise RuntimeError("Install pypdf and sentence-transformers for ingestion.") from e
        except Exception as e:
            logger.error("ingest_pdf_failed", filepath=filepath, error=str(e))
            raise

    async def ingest_directory(self, dir_path: str) -> dict[str, int]:
        """Ingest all documents (PDF, md, txt) in directory recursively. Returns {filepath: chunk_count}."""
        results: dict[str, int] = {}
        path = Path(dir_path)
        if not path.exists():
            return results

        for ext in ["*.pdf", "*.PDF", "*.md", "*.txt"]:
            for fp in path.rglob(ext):
                rel = str(fp.relative_to(path))
                parts = rel.split(os.sep)
                category = parts[0] if len(parts) > 1 else "general"
                try:
                    count = await self.ingest_pdf(str(fp), category)
                    results[str(fp)] = count
                except Exception as e:
                    logger.warning("ingest_skipped", filepath=str(fp), error=str(e))
        return results

    async def get_ingested_files(self) -> list[str]:
        """Get list of ingested filenames."""
        try:
            client = self._get_client()
            rows = await client.aquery("SELECT DISTINCT filename FROM knowledge_chunks")
            return [r.get("filename", "") for r in rows if r.get("filename")]
        except Exception as e:
            logger.error("get_ingested_files_failed", error=str(e))
            return []

    async def remove_document(self, filepath: str) -> bool:
        """Remove document by filename from D1 + Vectorize."""
        try:
            client = self._get_client()
            filename = os.path.basename(filepath)
            rows = await client.aquery(
                "SELECT id FROM knowledge_chunks WHERE filename = ?", [filename]
            )
            ids = [r["id"] for r in rows]
            if ids:
                await client.vectorize_delete(ids)
                await client.aexecute(
                    "DELETE FROM knowledge_chunks WHERE filename = ?", [filename]
                )
            return True
        except Exception as e:
            logger.error("remove_document_failed", filepath=filepath, error=str(e))
            return False
