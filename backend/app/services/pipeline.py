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
    ColorSuggestion,
    QuantizationResult,
    quantize_kmeans,
    quantize_median_cut,
    smooth_regions,
    suggest_color_count,
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
    smooth: int = 0,
) -> tuple[DecodedImage, QuantizationResult]:
    """Decode and quantize an image; `smooth` > 0 then cleans up noisy color regions."""
    image = decode_image(data, max_dimension)
    if algorithm == "median_cut":
        result = quantize_median_cut(image, colors, locked_colors=locked_colors)
    else:
        result = quantize_kmeans(
            image,
            colors,
            locked_colors=locked_colors,
            max_working_size=max_working_size,
            seed=seed,
        )
    return image, smooth_regions(result, smooth)


def suggest_colors(
    data: bytes, *, min_colors: int, max_colors: int, max_dimension: int
) -> ColorSuggestion:
    image = decode_image(data, max_dimension)
    return suggest_color_count(image, min_colors=min_colors, max_colors=max_colors)


# A border color counts as background when it covers at least this share of the border.
BACKGROUND_BORDER_SHARE = 0.5


def background_index(labels: NDArray[np.uint8]) -> int | None:
    """Palette index that dominates the image border (a likely background), if any.

    Transparent border pixels count against every color, so images whose background is
    already transparent get no suggestion.
    """
    border = np.concatenate([labels[0], labels[-1], labels[1:-1, 0], labels[1:-1, -1]])
    counts = np.bincount(border[border != TRANSPARENT_LABEL], minlength=1)
    index = int(counts.argmax())
    return index if counts[index] >= BACKGROUND_BORDER_SHARE * len(border) else None


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
    transparent: list[int] | None = None,
) -> VectorizeResult:
    """Trace an image to SVG.

    With `colors` the image is quantized first (one-shot mode); otherwise it must be an
    indexed PNG, e.g. the one returned by `/quantize` (indexed mode). Palette indices in
    `transparent` are left out (e.g. a removed background); the palette keeps them, so
    indices stay stable.
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

    if transparent:
        if max(transparent) >= len(palette):
            raise InvalidParameters(
                f"`transparent` indices must be below {len(palette)}.",
                {"field": "transparent", "palette_size": len(palette)},
            )
        labels = np.where(np.isin(labels, transparent), TRANSPARENT_LABEL, labels).astype(np.uint8)
        if (labels == TRANSPARENT_LABEL).all():
            raise InvalidParameters(
                "Nothing to trace: every color is transparent.", {"field": "transparent"}
            )

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
