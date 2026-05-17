"""Candidate-crop proposals for scan-time detection.

The MVP shape:

1. The whole image is always a candidate (top-1 fallback).
2. If Grounding DINO is available it produces N boxes for the labels
   "logo, character, mascot, toy, packaging, cartoon character".
3. Otherwise we fall back to a sliding-window grid so the detection flow
   still produces multiple boxes during local-only development.

The Grounding-DINO path is wrapped in a try/except so missing torch /
transformers fall back to the sliding window automatically.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

from PIL import Image

GROUNDING_DINO_LABELS = (
    "logo. character. mascot. toy. packaging. cartoon character."
)


@dataclass
class Proposal:
    crop: Image.Image
    bbox: tuple  # (x, y, w, h) in original-image pixel space


def whole_image(image: Image.Image) -> Proposal:
    return Proposal(crop=image, bbox=(0, 0, image.size[0], image.size[1]))


def sliding_window(image: Image.Image, tile: int = 320, stride: int = 224) -> List[Proposal]:
    width, height = image.size
    out: List[Proposal] = []
    if width <= tile and height <= tile:
        return out
    for y in range(0, max(1, height - tile + stride), stride):
        for x in range(0, max(1, width - tile + stride), stride):
            x2 = min(x + tile, width)
            y2 = min(y + tile, height)
            x1 = max(0, x2 - tile)
            y1 = max(0, y2 - tile)
            out.append(
                Proposal(
                    crop=image.crop((x1, y1, x2, y2)),
                    bbox=(x1, y1, x2 - x1, y2 - y1),
                ),
            )
    return out


def grounding_dino(image: Image.Image, threshold: float = 0.25) -> List[Proposal]:
    """Try to run Grounding DINO. Returns [] when transformers/torch missing."""
    try:
        import torch  # noqa: WPS433
        from transformers import (  # noqa: WPS433
            AutoModelForZeroShotObjectDetection,
            AutoProcessor,
        )
    except Exception:
        return []

    try:
        model_name = "IDEA-Research/grounding-dino-tiny"
        processor = AutoProcessor.from_pretrained(model_name)
        model = AutoModelForZeroShotObjectDetection.from_pretrained(model_name).eval()
        inputs = processor(images=image, text=GROUNDING_DINO_LABELS, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        results = processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            box_threshold=threshold,
            text_threshold=threshold,
            target_sizes=[image.size[::-1]],
        )[0]
    except Exception:
        return []

    out: List[Proposal] = []
    for box in results.get("boxes", []):
        x1, y1, x2, y2 = [int(v) for v in box.tolist()]
        if x2 <= x1 or y2 <= y1:
            continue
        out.append(
            Proposal(
                crop=image.crop((x1, y1, x2, y2)),
                bbox=(x1, y1, x2 - x1, y2 - y1),
            ),
        )
    return out


def propose(image: Image.Image) -> List[Proposal]:
    proposals: List[Proposal] = [whole_image(image)]
    proposals.extend(grounding_dino(image))
    if len(proposals) == 1:  # Grounding DINO unavailable
        proposals.extend(sliding_window(image))
    return proposals
