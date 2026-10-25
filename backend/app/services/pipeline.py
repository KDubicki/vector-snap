"""Orchestration of the processing steps used by the HTTP layer.

Keeps routes thin and lets other entry points (CLI, workers) reuse the same flow.
"""

import logging
import time
from dataclasses import asdict, dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

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
    MergedColor,
    QuantizationResult,
    merge_similar_colors,
    merge_small_colors,
    quantize_filaments,
    quantize_kmeans,
    quantize_median_cut,
    resolve_merges,
    smooth_regions,
    suggest_color_count,
)
from app.services.svg_postprocess import build_svg
from app.services.vectorization import TracingOptions, trace

Algorithm = Literal["kmeans", "median_cut", "filaments"]

logger = logging.getLogger(__name__)


def _ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


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
    upscale: bool = False,
    filaments: list[tuple[int, int, int]] | None = None,
    min_coverage: float = 0.0,
    merge_delta_e: float = 0.0,
) -> tuple[DecodedImage, QuantizationResult, list[MergedColor]]:
    """Decode and quantize an image; `smooth` > 0 then cleans up noisy color regions.

    `upscale` enlarges small images first (see `decode_image`). The `filaments` algorithm
    picks the palette from the given filament colors. Colors closer than `merge_delta_e`
    (CIEDE2000) are then merged into one (`merge_similar_colors`), and colors covering
    less than `min_coverage` of the image into their nearest (`merge_small_colors`).
    """
    started = time.perf_counter()
    image = decode_image(data, max_dimension, upscale=upscale)
    decode_ms = _ms(started)
    started = time.perf_counter()
    if algorithm == "filaments":
        result = quantize_filaments(image, filaments or [], colors, locked_colors=locked_colors)
    elif algorithm == "median_cut":
        result = quantize_median_cut(image, colors, locked_colors=locked_colors)
    else:
        result = quantize_kmeans(
            image,
            colors,
            locked_colors=locked_colors,
            max_working_size=max_working_size,
            seed=seed,
        )
    result = smooth_regions(result, smooth)
    result, similar = merge_similar_colors(result, merge_delta_e, locked_colors)
    result, small = merge_small_colors(result, min_coverage, locked_colors)
    merged = resolve_merges(similar + small)
    logger.info(
        "quantized image",
        extra={
            "width": image.width,
            "height": image.height,
            "colors": colors,
            "algorithm": algorithm,
            "locked_colors": len(locked_colors or []),
            "smooth": smooth,
            "upscale": upscale,
            "merged_colors": len(merged),
            "decode_ms": decode_ms,
            "quantize_ms": _ms(started),
        },
    )
    return image, result, merged


def suggest_colors(
    data: bytes, *, min_colors: int, max_colors: int, max_dimension: int
) -> ColorSuggestion:
    started = time.perf_counter()
    image = decode_image(data, max_dimension)
    decode_ms = _ms(started)
    started = time.perf_counter()
    suggestion = suggest_color_count(image, min_colors=min_colors, max_colors=max_colors)
    logger.info(
        "suggested color count",
        extra={
            "width": image.width,
            "height": image.height,
            "suggested_colors": suggestion.colors,
            "decode_ms": decode_ms,
            "suggest_ms": _ms(started),
        },
    )
    return suggestion


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


def clear_border_regions(labels: NDArray[np.uint8], indices: list[int]) -> NDArray[np.uint8]:
    """Labels with the regions of `indices` that reach the image border made transparent.

    The background around a motif touches the border; the same color enclosed by the
    motif (white eyes, the inside of letters) does not, and stays. Regions connect
    side by side, not diagonally, so a background seeping through a diagonal gap does
    not eat the inside; already transparent pixels pass the background on.
    """
    colored = np.isin(labels, indices)
    regions, _ = ndimage.label(colored | (labels == TRANSPARENT_LABEL))
    edge = np.concatenate([regions[0], regions[-1], regions[:, 0], regions[:, -1]])
    reaching = np.isin(regions, edge[edge != 0]) & colored
    return np.where(reaching, np.uint8(TRANSPARENT_LABEL), labels).astype(np.uint8)


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
    background: list[int] | None = None,
) -> VectorizeResult:
    """Trace an image to SVG.

    With `colors` the image is quantized first (one-shot mode); otherwise it must be an
    indexed PNG, e.g. the one returned by `/quantize` (indexed mode). Palette indices in
    `transparent` are left out everywhere; those in `background` only where they reach the
    image border (`clear_border_regions`: a removed background, keeping the same color
    inside the motif). The palette keeps them, so indices stay stable.
    """
    started = time.perf_counter()
    decode_ms = None  # one-shot mode: quantize_image logs decoding and quantizing
    if colors is not None:
        _, quantized, _ = quantize_image(
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
        decode_ms = _ms(started)

    if palette_override is not None:
        if len(palette_override) != len(palette):
            raise InvalidParameters(
                f"`palette` must contain exactly {len(palette)} colors.",
                {"field": "palette", "expected": len(palette)},
            )
        palette = np.array(palette_override, dtype=np.uint8).reshape(-1, 3)

    for field, indices in (("transparent", transparent), ("background", background)):
        if indices and max(indices) >= len(palette):
            raise InvalidParameters(
                f"`{field}` indices must be below {len(palette)}.",
                {"field": field, "palette_size": len(palette)},
            )
    if transparent:
        labels = np.where(np.isin(labels, transparent), TRANSPARENT_LABEL, labels).astype(np.uint8)
    if background:
        labels = clear_border_regions(labels, background)
    if (transparent or background) and (labels == TRANSPARENT_LABEL).all():
        raise InvalidParameters(
            "Nothing to trace: every color is transparent.",
            {"field": "transparent" if transparent else "background"},
        )

    height, width = labels.shape
    trace_started = time.perf_counter()
    document = build_svg(
        trace(labels, palette, options), palette, width, height, precision=options.path_precision
    )
    logger.info(
        "vectorized image",
        extra={
            "width": width,
            "height": height,
            "colors": len(palette),
            "transparent": len(transparent or []),
            "background": len(background or []),
            **asdict(options),
            "path_count": document.path_count,
            **({"decode_ms": decode_ms} if decode_ms is not None else {}),
            "trace_ms": _ms(trace_started),
        },
    )
    counts = np.bincount(labels[labels != TRANSPARENT_LABEL], minlength=len(palette))
    return VectorizeResult(
        svg=document.svg,
        width=width,
        height=height,
        palette=palette,
        coverage=counts[: len(palette)] / max(int(counts.sum()), 1),
        path_count=document.path_count,
        duration_ms=_ms(started),
    )
