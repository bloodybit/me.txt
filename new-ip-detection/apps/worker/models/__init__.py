"""Embedding model interface + concrete implementations.

The worker only depends on the abstract ``EmbeddingModel`` (name, dim,
embed_image, embed_batch). Implementations are loaded lazily based on the
``EMBEDDING_MODEL`` env var so that the lightweight fake model can run
without heavy ML dependencies (torch, transformers).
"""

from .base import EmbeddingModel
from .fake import FakeEmbeddingModel


def load(name: str, dim: int) -> EmbeddingModel:
    """Resolve an EmbeddingModel by name. Falls back to the fake model."""
    if name == "siglip2" or name.startswith("google/siglip2"):
        # Imported lazily — the ML stack is optional.
        from .siglip2 import Siglip2EmbeddingModel  # noqa: WPS433

        return Siglip2EmbeddingModel()
    return FakeEmbeddingModel(dim=dim)


__all__ = ["EmbeddingModel", "FakeEmbeddingModel", "load"]
