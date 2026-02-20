"""Free local embeddings using sentence-transformers - no API key required."""

from typing import List

import structlog

logger = structlog.get_logger(__name__)

# Lazy load model to avoid import overhead
_model = None
_model_name = "sentence-transformers/all-MiniLM-L6-v2"


def _get_model():
    """Lazy load sentence-transformers model."""
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            logger.info("loading_embedding_model", model=_model_name)
            _model = SentenceTransformer(_model_name)
            logger.info("embedding_model_loaded", model=_model_name)
        except ImportError:
            raise RuntimeError(
                "sentence-transformers not installed. Run: pip install sentence-transformers"
            )
    return _model


def get_embeddings(texts: List[str]) -> List[List[float]]:
    """Get embeddings for a list of texts using local sentence-transformers model."""
    model = _get_model()
    # sentence-transformers encode is synchronous and handles batching
    embeddings = model.encode(texts, convert_to_numpy=False, show_progress_bar=False)
    return [emb.tolist() if hasattr(emb, "tolist") else list(emb) for emb in embeddings]


def _get_embedding_sync(text: str) -> List[float]:
    """Sync single embedding for LlamaIndex."""
    return get_embeddings([text])[0]


class LocalEmbedding:
    """LlamaIndex-compatible embedding using free local sentence-transformers."""

    def _get_query_embedding(self, query: str) -> List[float]:
        return _get_embedding_sync(query)

    def _get_text_embedding(self, text: str) -> List[float]:
        return _get_embedding_sync(text)

    def _get_text_embeddings(self, texts: List[str]) -> List[List[float]]:
        return get_embeddings(texts)

    @classmethod
    def class_name(cls) -> str:
        return "LocalEmbedding"


def get_embed_model():
    """Return free local embedding model. No API key required."""
    return LocalEmbedding()
