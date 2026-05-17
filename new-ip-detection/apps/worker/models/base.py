"""Abstract embedding model contract."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List

from PIL import Image


class EmbeddingModel(ABC):
    name: str
    dim: int

    @abstractmethod
    def embed_image(self, image: Image.Image) -> List[float]:
        """Return a unit-normalized embedding vector for a single image."""

    def embed_batch(self, images: List[Image.Image]) -> List[List[float]]:
        """Batch embed. Default falls back to looping; subclasses can override."""
        return [self.embed_image(img) for img in images]
