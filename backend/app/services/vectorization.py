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
from scipy import ndimage

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


def absorb_specks(
    label_rank: NDArray[np.int64], opaque: NDArray[np.bool_], filter_speckle: int
) -> NDArray[np.int64]:
    """Give specks that vtracer would drop the color of the nearest larger region.

    vtracer discards patches of fewer than `filter_speckle`² pixels (4-connected). Traced
    per color, such a speck would leave a hole in the color around it; merged into its
    neighbour first, the hole is never there.
    """
    if filter_speckle <= 1:
        return label_rank
    small = np.zeros_like(opaque)
    for position in np.unique(label_rank[opaque]):
        components, count = ndimage.label(label_rank == position)
        sizes = np.bincount(components.ravel(), minlength=count + 1)
        tiny = sizes < filter_speckle * filter_speckle
        tiny[0] = False  # background of the component labelling
        small |= tiny[components]
    kept = opaque & ~small
    if not small.any() or not kept.any():
        return label_rank
    _, (rows, columns) = ndimage.distance_transform_edt(~kept, return_indices=True)
    result = label_rank.copy()
    result[small] = label_rank[rows[small], columns[small]]
    return result


def trace(
    labels: NDArray[np.uint8], palette: NDArray[np.uint8], options: TracingOptions
) -> list[TracedLayer]:
    """Trace every color layer, bottom (largest coverage) to top.

    - cutout: each layer covers its own pixels and overlaps the layers below it by one
      pixel. Colors are smoothed independently, so without the overlap their outlines
      would leave thin gaps between them; the layer drawn on top hides it.
    - stacked: each layer also covers all layers above it, so lower layers extend under
      upper ones and no seams can appear between colors.
    """
    groups = color_layers(palette)
    opaque = labels != TRANSPARENT_LABEL
    rank = np.full(256, len(groups), dtype=np.int64)
    for position, indices in enumerate(groups):
        rank[indices] = position
    label_rank = rank[labels]
    used = np.zeros(len(groups) + 1, dtype=np.bool_)
    used[np.unique(label_rank)] = True
    if options.stacking == "cutout":
        label_rank = absorb_specks(label_rank, opaque, options.filter_speckle)

    layers: list[TracedLayer] = []
    for position, indices in enumerate(groups):
        if not used[position]:
            # Unused color: in stacked mode it would otherwise become a hidden background.
            continue
        own_pixels = label_rank == position
        if options.stacking == "stacked":
            mask = opaque & (label_rank >= position)
        else:
            mask = own_pixels | (
                ndimage.binary_dilation(own_pixels) & opaque & (label_rank < position)
            )
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
