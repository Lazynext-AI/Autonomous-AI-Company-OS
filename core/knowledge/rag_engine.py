"""RAG engine - Vectorize similarity search + Atlas Cloud answer generation."""

from dataclasses import dataclass
from typing import Any

import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


@dataclass
class Source:
    """RAG source citation."""

    filename: str
    category: str
    chunk_text: str
    relevance_score: float
    page_number: int | None = None


@dataclass
class DocumentMeta:
    """Document metadata."""

    filename: str
    category: str
    chunk_count: int
    ingested_at: str


@dataclass
class RAGResult:
    """RAG query result."""

    answer: str | None
    sources: list[Source]
    confidence: float
    needs_download: bool = False


class RAGEngine:
    """Query knowledge base with RAG (Vectorize + D1 chunk store)."""

    def __init__(self) -> None:
        self._settings = get_settings()

    def _get_client(self):
        from core.cloudflare_client import CloudflareClient
        return CloudflareClient()

    async def query(self, question: str, n_results: int = 5) -> RAGResult:
        """Query RAG without category filter."""
        return await self.query_with_category(question, "", n_results)

    async def query_with_category(
        self,
        question: str,
        category: str,
        n_results: int = 5,
    ) -> RAGResult:
        """Query RAG with optional category filter."""
        try:
            from core.llm.local_embedding import get_embeddings

            client = self._get_client()
            if not client.is_configured():
                return RAGResult(answer=None, sources=[], confidence=0.0, needs_download=True)

            vector = get_embeddings([question])[0]
            filt = {"category": {"$eq": category}} if category else None
            matches = await client.vectorize_query(vector, top_k=n_results, filter=filt)

            if not matches:
                return RAGResult(
                    answer=None,
                    sources=[],
                    confidence=0.0,
                    needs_download=True,
                )

            chunk_ids = [m.get("id", "") for m in matches if m.get("id")]
            texts: dict[str, str] = {}
            if chunk_ids:
                marks = ", ".join("?" for _ in chunk_ids)
                rows = await client.aquery(
                    f"SELECT id, content FROM knowledge_chunks WHERE id IN ({marks})",
                    chunk_ids,
                )
                texts = {r["id"]: r.get("content", "") for r in rows}

            sources = []
            for m in matches:
                meta = m.get("metadata") or {}
                chunk_id = m.get("id", "")
                sources.append(Source(
                    filename=meta.get("filename", ""),
                    category=meta.get("category", ""),
                    chunk_text=(texts.get(chunk_id, "") or "")[:500],
                    relevance_score=float(m.get("score", 0.5)),
                    page_number=meta.get("page_number"),
                ))

            avg_score = sum(s.relevance_score for s in sources) / len(sources) if sources else 0
            confidence = min(1.0, avg_score * 1.2)

            if confidence < 0.5:
                return RAGResult(
                    answer=None,
                    sources=sources,
                    confidence=confidence,
                    needs_download=True,
                )

            context = "\n\n".join(s.chunk_text for s in sources)
            from core.llm.atlas_client import AtlasClient
            from core.config import get_light_model
            atlas = AtlasClient()
            try:
                answer = await atlas.chat_completion(
                    get_light_model(),
                    [{"role": "user", "content": f"Based on this context, answer the question.\n\nContext:\n{context}\n\nQuestion: {question}"}],
                    system_prompt="Answer concisely using only the provided context. If the context doesn't contain the answer, say so.",
                )
            finally:
                await atlas.close()

            return RAGResult(
                answer=answer,
                sources=sources,
                confidence=confidence,
                needs_download=False,
            )
        except ImportError as e:
            logger.error("rag_import_failed", error=str(e))
            return RAGResult(answer=None, sources=[], confidence=0.0, needs_download=True)
        except Exception as e:
            logger.error("rag_query_failed", question=question[:50], error=str(e))
            return RAGResult(answer=None, sources=[], confidence=0.0, needs_download=True)

    async def get_available_categories(self) -> list[str]:
        """Get list of categories in knowledge base."""
        try:
            client = self._get_client()
            rows = await client.aquery(
                "SELECT DISTINCT category FROM knowledge_chunks WHERE category != ''"
            )
            return sorted(r.get("category", "") for r in rows if r.get("category"))
        except Exception:
            return []

    async def get_document_list(self) -> list[DocumentMeta]:
        """Get list of ingested documents."""
        try:
            client = self._get_client()
            rows = await client.aquery(
                """SELECT filename, category, COUNT(*) AS chunks, MIN(ingested_at) AS ingested_at
                   FROM knowledge_chunks GROUP BY filename, category ORDER BY filename"""
            )
            return [
                DocumentMeta(
                    filename=r.get("filename", ""),
                    category=r.get("category", ""),
                    chunk_count=int(r.get("chunks", 0)),
                    ingested_at=r.get("ingested_at", ""),
                )
                for r in rows
            ]
        except Exception:
            return []
