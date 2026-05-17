"""SigLIP2 image-only embedding model.

Wraps ``google/siglip2-base-patch16-224`` from HuggingFace transformers.
Loads once at construction; embed_image / embed_batch reuse the loaded
weights. Heavy: only used when EMBEDDING_MODEL=siglip2 is set.
"""

from __future__ import annotations

from typing import List

import numpy as np
from PIL import Image

from .base import EmbeddingModel


class Siglip2EmbeddingModel(EmbeddingModel):
    name = "google/siglip2-base-patch16-224"
    dim = 768

    def __init__(self) -> None:
        # Imported here so the module can be imported even when torch is
        # not installed in the lightweight container.
        import torch  # noqa: WPS433
        from transformers import AutoModel, AutoProcessor  # noqa: WPS433

        self._torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = AutoProcessor.from_pretrained(self.name)
        self.model = AutoModel.from_pretrained(self.name).to(self.device).eval()

    def embed_image(self, image: Image.Image) -> List[float]:
        return self.embed_batch([image])[0]

    def embed_batch(self, images: List[Image.Image]) -> List[List[float]]:
        torch = self._torch
        prepped = self.processor(images=images, return_tensors="pt").to(self.device)
        with torch.no_grad():
            features = self.model.get_image_features(**prepped)
            features = features / features.norm(p=2, dim=-1, keepdim=True)
        arr: np.ndarray = features.cpu().numpy()
        return [row.tolist() for row in arr]
