"""Handler for the ``detect_scan`` job kind."""

from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass
from typing import Dict, List, Tuple

import httpx
import numpy as np
from PIL import Image

from models.base import EmbeddingModel
from preprocess import preprocess
from proposals import Proposal, propose

log = logging.getLogger(__name__)

DEFAULT_SCORE_THRESHOLD = float(os.environ.get("DETECTION_SCORE_THRESHOLD", "0.55"))
IOU_NMS_THRESHOLD = float(os.environ.get("DETECTION_NMS_IOU", "0.5"))


@dataclass
class _Match:
    subject_id: str
    reference_image_id: str
    score: float
    bbox: Tuple[int, int, int, int]


def _iou(a: Tuple[int, int, int, int], b: Tuple[int, int, int, int]) -> float:
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    intersect = iw * ih
    if intersect == 0:
        return 0.0
    union = aw * ah + bw * bh - intersect
    return intersect / union if union > 0 else 0.0


def _nms_per_subject(matches: List[_Match]) -> List[_Match]:
    by_subject: Dict[str, List[_Match]] = {}
    for m in matches:
        by_subject.setdefault(m.subject_id, []).append(m)

    kept: List[_Match] = []
    for subject_matches in by_subject.values():
        subject_matches.sort(key=lambda m: m.score, reverse=True)
        survivors: List[_Match] = []
        for candidate in subject_matches:
            if any(_iou(candidate.bbox, k.bbox) > IOU_NMS_THRESHOLD for k in survivors):
                continue
            survivors.append(candidate)
        kept.extend(survivors)
    return kept


def handle(api: httpx.Client, job: dict, model: EmbeddingModel) -> dict:
    ctx = api.get(f"/internal/scan-jobs/{job['id']}/context").raise_for_status().json()

    refs = ctx["references"]
    if not refs:
        return {"detections": []}

    image_bytes = httpx.get(ctx["download_url"], timeout=60).raise_for_status().content
    raw = Image.open(io.BytesIO(image_bytes))
    image, _ = preprocess(raw)

    proposals: List[Proposal] = propose(image)
    crops = [p.crop for p in proposals]
    crop_embeddings = model.embed_batch(crops)

    ref_matrix = np.array([r["embedding"] for r in refs], dtype=np.float32)
    crop_matrix = np.array(crop_embeddings, dtype=np.float32)

    # Both sides are already unit-normalized — cosine == dot product.
    scores = crop_matrix @ ref_matrix.T  # (n_crops, n_refs)

    matches: List[_Match] = []
    for i, prop in enumerate(proposals):
        # For each crop, take the best score per subject (max-of-references, Decision N).
        per_subject_best: Dict[str, Tuple[float, str]] = {}
        for j, ref in enumerate(refs):
            score = float(scores[i, j])
            best = per_subject_best.get(ref["subject_id"])
            if best is None or score > best[0]:
                per_subject_best[ref["subject_id"]] = (score, ref["reference_image_id"])
        for subject_id, (score, ref_id) in per_subject_best.items():
            if score < DEFAULT_SCORE_THRESHOLD:
                continue
            matches.append(
                _Match(
                    subject_id=subject_id,
                    reference_image_id=ref_id,
                    score=score,
                    bbox=tuple(prop.bbox),
                ),
            )

    kept = _nms_per_subject(matches)

    method = "siglip2_grounding_dino" if model.name.startswith("google/siglip2") else "fake_whole_image"
    detections = [
        {
            "subject_id": m.subject_id,
            "reference_image_id": m.reference_image_id,
            "score": m.score,
            # Confidence is reported per-match — for the MVP we re-use the score as confidence.
            "confidence": m.score,
            "bbox": {"x": m.bbox[0], "y": m.bbox[1], "w": m.bbox[2], "h": m.bbox[3]},
            "method": method,
            "model": model.name,
        }
        for m in kept
    ]

    log.info("scan %s produced %d detections from %d proposals", ctx["scan_id"], len(detections), len(proposals))
    return {"detections": detections}
