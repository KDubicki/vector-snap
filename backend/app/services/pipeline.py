"""Orchestration of the processing steps used by the HTTP layer.

Keeps routes thin and lets other entry points (CLI, workers) reuse the same flow.
"""

from typing import Literal

import numpy as np

from app.services.image_io import DecodedImage, decode_image, encode_indexed_png
from app.services.quantization import (
    TRANSPARENT_LABEL,
    QuantizationResult,
    quantize_kmeans,
    quantize_median_cut,
)

Algorithm = Literal["kmeans", "median_cut"]


def quantize_image(
    data: bytes,
    *,
    colors: int,
    algorithm: Algorithm,
    max_dimension: int,
    locked_colors: list[tuple[int, int, int]] | None = None,
    max_working_size: int = 1024,
    seed: int = 0,
) -> tuple[DecodedImage, QuantizationResult]:
    image = decode_image(data, max_dimension)
    if algorithm == "median_cut":
        return image, quantize_median_cut(image, colors)
    result = quantize_kmeans(
        image,
        colors,
        locked_colors=locked_colors,
        max_working_size=max_working_size,
        seed=seed,
    )
    return image, result


def to_indexed_png(result: QuantizationResult) -> bytes:
    """Encode a quantization result; transparent pixels get the index after the palette."""
    if not result.has_transparency:
        return encode_indexed_png(result.labels, result.palette, None)
    transparent_index = len(result.palette)
    labels = np.where(
        result.labels == TRANSPARENT_LABEL, np.uint8(transparent_index), result.labels
    ).astype(np.uint8)
    return encode_indexed_png(labels, result.palette, transparent_index)
