"""Knowledge ingestion pipeline - PDF to ChromaDB with embeddings."""

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


class KnowledgeIngestion:
    """Ingest PDFs into ChromaDB with LlamaIndex."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._chroma_path = self._settings.chroma_persist_dir
        self._collection_name = "company_knowledge"
        self._vector_store = None
        self._index = None

    def _ensure_chroma_dir(self) -> None:
        """Ensure ChromaDB directory exists."""
        Path(self._chroma_path).mkdir(parents=True, exist_ok=True)

    async def ingest_pdf(self, filepath: str, category: str) -> int:
        """Ingest single PDF. Returns chunk count."""
        self._ensure_chroma_dir()
        try:
            from llama_index.core import Document, VectorStoreIndex, Settings as LlamaSettings
            from llama_index.core.node_parser import SentenceSplitter
            from llama_index.vector_stores.chroma import ChromaVectorStore
            from core.llm.local_embedding import get_embed_model
            import chromadb

            LlamaSettings.embed_model = get_embed_model()
            LlamaSettings.chunk_size = 512
            LlamaSettings.chunk_overlap = 50

            splitter = SentenceSplitter(chunk_size=512, chunk_overlap=50)
            chroma_client = chromadb.PersistentClient(path=self._chroma_path)
            collection = chroma_client.get_or_create_collection(
                self._collection_name,
                metadata={"hnsw:space": "cosine"},
            )
            vector_store = ChromaVectorStore(chroma_collection=collection)

            from llama_index.core import SimpleDirectoryReader
            reader = SimpleDirectoryReader(input_files=[filepath])
            documents = reader.load_data()

            nodes = []
            for i, doc in enumerate(documents):
                doc.metadata["filename"] = os.path.basename(filepath)
                doc.metadata["category"] = category
                doc.metadata["ingested_at"] = datetime.now(timezone.utc).isoformat()
                doc.metadata["chunk_index"] = i
                chunk_nodes = splitter.get_nodes_from_documents([doc])
                for j, node in enumerate(chunk_nodes):
                    node.metadata["chunk_index"] = j
                    node.metadata["total_chunks"] = len(chunk_nodes)
                nodes.extend(chunk_nodes)

            index = VectorStoreIndex(nodes, vector_store=vector_store)
            return len(nodes)
        except ImportError as e:
            logger.error("ingestion_import_failed", error=str(e))
            raise RuntimeError("Install llama-index, chromadb, llama-index-vector-stores-chroma, sentence-transformers for embeddings.") from e
        except Exception as e:
            logger.error("ingest_pdf_failed", filepath=filepath, error=str(e))
            raise

    async def ingest_directory(self, dir_path: str) -> dict[str, int]:
        """Ingest all PDFs in directory recursively. Returns {filepath: chunk_count}."""
        results: dict[str, int] = {}
        path = Path(dir_path)
        if not path.exists():
            return results

        for ext in ["*.pdf", "*.PDF"]:
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
        """Get list of ingested file paths from metadata."""
        try:
            import chromadb
            client = chromadb.PersistentClient(path=self._chroma_path)
            coll = client.get_or_create_collection(self._collection_name)
            results = coll.get(include=["metadatas"])
            files = set()
            for m in (results.get("metadatas") or []):
                if m and "filename" in m:
                    files.add(m.get("filename", ""))
            return list(files)
        except Exception as e:
            logger.error("get_ingested_files_failed", error=str(e))
            return []

    async def remove_document(self, filepath: str) -> bool:
        """Remove document by filename from ChromaDB."""
        try:
            import chromadb
            client = chromadb.PersistentClient(path=self._chroma_path)
            coll = client.get_or_create_collection(self._collection_name)
            filename = os.path.basename(filepath)
            coll.delete(where={"filename": filename})
            return True
        except Exception as e:
            logger.error("remove_document_failed", filepath=filepath, error=str(e))
            return False
