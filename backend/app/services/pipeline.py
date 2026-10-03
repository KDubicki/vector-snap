"""Orchestration of the processing steps used by the HTTP layer.

Keeps routes thin and lets other entry points (CLI, workers) reuse the same flow.
"""

import time
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray

from app.core.errors import InvalidParameters, NotIndexedImage
from app.services.image_io import (
    DecodedImage,
    decode_image,
    decode_indexed_png,
    encode_indexed_png,
)
from app.services.quantization import (
    TRANSPARENT_LABEL,
    QuantizationResult,
    quantize_kmeans,
    quantize_median_cut,
)
from app.services.svg_postprocess import build_svg
from app.services.vectorization import TracingOptions, trace

Algorithm = Literal["kmeans", "median_cut"]


@dataclass(frozen=True)
class VectorizeResult:
    svg: str
    width: int
    height: int
    palette: NDArray[np.uint8]  # final colors, one per palette index
    coverage: NDArray[np.float64]
    path_count: int
    duration_ms: int


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


def vectorize_image(
    data: bytes,
    *,
    max_dimension: int,
    options: TracingOptions,
    palette_override: list[tuple[int, int, int]] | None = None,
    colors: int | None = None,
    algorithm: Algorithm = "kmeans",
) -> VectorizeResult:
    """Trace an image to SVG.

    With `colors` the image is quantized first (one-shot mode); otherwise it must be an
    indexed PNG, e.g. the one returned by `/quantize` (indexed mode).
    """
    started = time.perf_counter()
    if colors is not None:
        _, quantized = quantize_image(
            data, colors=colors, algorithm=algorithm, max_dimension=max_dimension
        )
        labels, palette = quantized.labels, quantized.palette
    else:
        try:
            indexed = decode_indexed_png(data, max_dimension)
        except NotIndexedImage as exc:
            raise InvalidParameters(
                "Image is not an indexed PNG; pass `colors` to quantize it first.",
                {"field": "colors"},
            ) from exc
        labels, palette = indexed.labels, indexed.palette

    if palette_override is not None:
        if len(palette_override) != len(palette):
            raise InvalidParameters(
                f"`palette` must contain exactly {len(palette)} colors.",
                {"field": "palette", "expected": len(palette)},
            )
        palette = np.array(palette_override, dtype=np.uint8).reshape(-1, 3)

    height, width = labels.shape
    document = build_svg(
        trace(labels, palette, options), palette, width, height, precision=options.path_precision
    )
    counts = np.bincount(labels[labels != TRANSPARENT_LABEL], minlength=len(palette))
    return VectorizeResult(
        svg=document.svg,
        width=width,
        height=height,
        palette=palette,
        coverage=counts[: len(palette)] / max(int(counts.sum()), 1),
        path_count=document.path_count,
        duration_ms=round((time.perf_counter() - started) * 1000),
    )
