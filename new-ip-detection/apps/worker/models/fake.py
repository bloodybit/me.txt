"""Deterministic fake embedding model.

Hashes pixel data to derive a stable embedding. Lets the full pipeline run
locally without downloading any real ML model. Embeddings produced here are
*not* semantically meaningful — they are only useful for end-to-end testing
of the queue, storage, and DB flow.
"""

from __future__ import annotations

import hashlib
import math
from typing import List

import numpy as np
from PIL import Image

from .base import EmbeddingModel


class FakeEmbeddingModel(EmbeddingModel):
    name = "fake-deterministic-v1"

    def __init__(self, dim: int = 768) -> None:
        self.dim = dim

    def embed_image(self, image: Image.Image) -> List[float]:
        # Downscale + grayscale so equivalent images map to the same seed.
        small = image.convert("L").resize((32, 32), Image.BILINEAR)
        digest = hashlib.sha256(small.tobytes()).digest()
        # Expand the digest into ``dim`` floats deterministically.
        rng = np.random.default_rng(int.from_bytes(digest[:8], "big"))
        vec = rng.standard_normal(self.dim).astype(np.float32)
        norm = float(np.linalg.norm(vec))
        if norm == 0 or math.isnan(norm):
            return [0.0] * self.dim
        return (vec / norm).tolist()
