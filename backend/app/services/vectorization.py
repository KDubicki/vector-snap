"""Raster-to-vector tracing with vtracer, one binary layer per palette color.

vtracer's own color mode re-clusters colors and merges small regions into neighbours
with averaged colors. Tracing each color as a binary mask instead keeps every region and
guarantees that only palette colors appear in the output.
See docs/06-image-processing-pipeline.md, sections 4-5.
"""

import io
from dataclasses import dataclass
from typing import Literal

import numpy as np
import vtracer
from numpy.typing import NDArray
from PIL import Image

from app.services.image_io import TRANSPARENT_LABEL

TracingMode = Literal["spline", "polygon"]
Stacking = Literal["stacked", "cutout"]


@dataclass(frozen=True)
class TracingOptions:
    mode: TracingMode = "spline"
    stacking: Stacking = "cutout"
    filter_speckle: int = 4
    corner_threshold: int = 60
    length_threshold: float = 4.0
    splice_threshold: int = 45
    path_precision: int = 2


@dataclass(frozen=True)
class TracedLayer:
    palette_index: int  # first palette index with this color
    raw_svg: str  # vtracer output for the layer's binary mask


def color_layers(palette: NDArray[np.uint8]) -> list[list[int]]:
    """Group palette indices by identical color, in palette (coverage) order.

    Indices sharing a color (merged by the user) are traced as one region.
    """
    layers: dict[tuple[int, int, int], list[int]] = {}
    for index, color in enumerate(palette):
        key = (int(color[0]), int(color[1]), int(color[2]))
        layers.setdefault(key, []).append(index)
    return list(layers.values())


def _mask_png(mask: NDArray[np.bool_]) -> bytes:
    """Encode a mask as black (traced) on white for vtracer's binary mode."""
    buffer = io.BytesIO()
    Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), mode="L").save(buffer, "PNG")
    return buffer.getvalue()


def trace(
    labels: NDArray[np.uint8], palette: NDArray[np.uint8], options: TracingOptions
) -> list[TracedLayer]:
    """Trace every color layer, bottom (largest coverage) to top.

    - cutout: each layer covers only its own pixels, so shapes never overlap.
    - stacked: each layer also covers all layers above it, so lower layers extend under
      upper ones and no seams can appear between colors.
    """
    groups = color_layers(palette)
    opaque = labels != TRANSPARENT_LABEL
    rank = np.full(256, len(groups), dtype=np.int64)
    for position, indices in enumerate(groups):
        rank[indices] = position
    label_rank = rank[labels]

    layers: list[TracedLayer] = []
    for position, indices in enumerate(groups):
        own_pixels = label_rank == position
        if not own_pixels.any():
            # Unused color: in stacked mode it would otherwise become a hidden background.
            continue
        mask = opaque & (label_rank >= position) if options.stacking == "stacked" else own_pixels
        raw_svg: str = vtracer.convert_raw_image_to_svg(
            _mask_png(mask),
            img_format="png",
            colormode="binary",
            mode=options.mode,
            filter_speckle=options.filter_speckle,
            corner_threshold=options.corner_threshold,
            length_threshold=options.length_threshold,
            splice_threshold=options.splice_threshold,
            path_precision=options.path_precision,
        )
        layers.append(TracedLayer(palette_index=indices[0], raw_svg=raw_svg))
    return layers
