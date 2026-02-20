"""RAG engine - query ChromaDB with LlamaIndex."""

from dataclasses import dataclass
from pathlib import Path
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
    """Query knowledge base with RAG."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._chroma_path = self._settings.chroma_persist_dir
        self._collection_name = "company_knowledge"

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
            from llama_index.core import VectorStoreIndex, Settings as LlamaSettings
            from llama_index.vector_stores.chroma import ChromaVectorStore
            from core.llm.local_embedding import get_embed_model
            import chromadb

            Path(self._chroma_path).mkdir(parents=True, exist_ok=True)
            LlamaSettings.embed_model = get_embed_model()

            client = chromadb.PersistentClient(path=self._chroma_path)
            try:
                coll = client.get_collection(self._collection_name)
            except Exception:
                return RAGResult(
                    answer=None,
                    sources=[],
                    confidence=0.0,
                    needs_download=True,
                )

            vector_store = ChromaVectorStore(chroma_collection=coll)
            index = VectorStoreIndex.from_vector_store(vector_store)

            where = {"category": category} if category else None
            retriever = index.as_retriever(similarity_top_k=n_results)
            nodes = retriever.retrieve(question)

            if not nodes:
                return RAGResult(
                    answer=None,
                    sources=[],
                    confidence=0.0,
                    needs_download=True,
                )

            sources = []
            for n in nodes:
                meta = n.metadata or {}
                score = float(n.score) if hasattr(n, "score") and n.score else 0.5
                sources.append(Source(
                    filename=meta.get("filename", ""),
                    category=meta.get("category", ""),
                    chunk_text=n.text[:500] if n.text else "",
                    relevance_score=score,
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

            # Use Claude for answer generation (Haiku for cost-effective RAG)
            context = "\n\n".join(s.chunk_text for s in sources)
            from core.llm.claude_client import ClaudeClient
            claude = ClaudeClient()
            try:
                answer = await claude.chat_completion(
                    "claude-haiku-4-5",
                    [{"role": "user", "content": f"Based on this context, answer the question.\n\nContext:\n{context}\n\nQuestion: {question}"}],
                    system_prompt="Answer concisely using only the provided context. If the context doesn't contain the answer, say so.",
                )
            finally:
                await claude.close()

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
            import chromadb
            client = chromadb.PersistentClient(path=self._chroma_path)
            coll = client.get_collection(self._collection_name)
            results = coll.get(include=["metadatas"])
            cats = set()
            for m in (results.get("metadatas") or []):
                if m and "category" in m:
                    cats.add(m.get("category", ""))
            return sorted(c for c in cats if c)
        except Exception:
            return []

    async def get_document_list(self) -> list[DocumentMeta]:
        """Get list of ingested documents."""
        try:
            import chromadb
            from collections import defaultdict
            client = chromadb.PersistentClient(path=self._chroma_path)
            coll = client.get_collection(self._collection_name)
            results = coll.get(include=["metadatas"])
            by_file: dict[str, dict[str, Any]] = defaultdict(lambda: {"chunks": 0, "category": "", "ingested_at": ""})
            for m in (results.get("metadatas") or []):
                if m and "filename" in m:
                    f = m.get("filename", "")
                    by_file[f]["chunks"] += 1
                    by_file[f]["category"] = m.get("category", "")
                    by_file[f]["ingested_at"] = m.get("ingested_at", "")
            return [
                DocumentMeta(filename=f, category=d["category"], chunk_count=d["chunks"], ingested_at=d["ingested_at"])
                for f, d in by_file.items()
            ]
        except Exception:
            return []
