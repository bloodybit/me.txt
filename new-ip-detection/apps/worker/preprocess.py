"""Image preprocessing.

Normalize uploads so downstream embeddings are stable:
  * convert to RGB
  * autocrop transparent / near-white borders (logo crops)
  * resize so the longest edge is at most ``max_edge`` pixels
"""

from __future__ import annotations

from typing import Tuple

import numpy as np
from PIL import Image


def preprocess(image: Image.Image, max_edge: int = 1024) -> Tuple[Image.Image, Tuple[int, int]]:
    img = image.convert("RGBA") if image.mode in ("LA", "P") else image
    img = autocrop_borders(img)
    img = img.convert("RGB")
    width, height = img.size
    if max(width, height) > max_edge:
        scale = max_edge / float(max(width, height))
        new_size = (int(width * scale), int(height * scale))
        img = img.resize(new_size, Image.BILINEAR)
    return img, img.size


def autocrop_borders(image: Image.Image) -> Image.Image:
    """Trim away alpha-transparent or near-white borders before embedding."""
    if image.mode == "RGBA":
        alpha = np.array(image.split()[-1])
        mask = alpha > 8
        return _crop_to_mask(image, mask)

    arr = np.array(image.convert("RGB"))
    luminance = arr.mean(axis=2)
    mask = luminance < 245
    return _crop_to_mask(image, mask)


def _crop_to_mask(image: Image.Image, mask: np.ndarray) -> Image.Image:
    if not mask.any():
        return image
    ys, xs = np.where(mask)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return image.crop(box)
