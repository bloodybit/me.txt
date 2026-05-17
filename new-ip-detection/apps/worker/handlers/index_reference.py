"""Handler for the ``index_reference`` job kind."""

from __future__ import annotations

import io
import logging

import httpx
from PIL import Image

from models.base import EmbeddingModel
from preprocess import preprocess

log = logging.getLogger(__name__)


def handle(api: httpx.Client, job: dict, model: EmbeddingModel) -> dict:
    ctx_url = f"/internal/index-jobs/{job['id']}/context"
    ctx = api.get(ctx_url).raise_for_status().json()

    image_bytes = httpx.get(ctx["download_url"], timeout=60).raise_for_status().content
    image = Image.open(io.BytesIO(image_bytes))
    processed, (width, height) = preprocess(image)

    embedding = model.embed_image(processed)

    log.info(
        "indexed reference_image_id=%s subject_id=%s dim=%d",
        ctx["reference_image_id"],
        ctx["subject_id"],
        len(embedding),
    )

    return {
        "model": model.name,
        "dim": model.dim,
        "embedding": embedding,
        "width": width,
        "height": height,
    }
