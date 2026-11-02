"""Grow or shrink shapes on the server: bleed for stickers and print-and-cut, kerf
compensation for lasers and cutters, thicker thin lines for printing.

Every shape's outline moves `distance` document px outwards (positive) or inwards
(negative), holes the other way, with round or sharp corners. A shape shrunk to nothing
is removed. Curves become polylines. See docs/05-api-specification.md#post-apiv1svgoffset.
"""

from collections.abc import Collection
from dataclasses import dataclass, replace
from typing import Literal

from app.core.errors import InvalidParameters
from app.services.svg_geometry import (
    VectorDocument,
    VectorShape,
    flatten,
    path_data,
    to_polygon,
)

Corners = Literal["round", "sharp"]

# Pieces of a shrunk shape smaller than this (document px²) are slivers, as in the cuts.
MIN_AREA = 0.5


@dataclass(frozen=True)
class OffsetShapes:
    document: VectorDocument
    offset: list[str]  # ids of the grown or shrunk shapes, in document order
    removed: list[str]  # ids of the shapes shrunk to nothing


def offset_shapes(
    document: VectorDocument,
    distance: float,
    ids: Collection[str] = (),
    corners: Corners = "round",
) -> OffsetShapes:
    """Grow (`distance` > 0) or shrink (< 0) the shapes in `ids`, every shape without."""
    wanted = set(ids)
    join_style = "round" if corners == "round" else "mitre"
    offset: list[str] = []
    removed: list[str] = []
    layers = []
    for layer in document.layers:
        shapes: list[VectorShape] = []
        for shape in layer.shapes:
            if wanted and shape.id not in wanted:
                shapes.append(shape)
                continue
            moved = to_polygon(flatten(shape.d)).buffer(
                distance, quad_segs=8, join_style=join_style
            )
            if moved.is_empty or moved.area < MIN_AREA:
                removed.append(shape.id)
                continue
            offset.append(shape.id)
            shapes.append(replace(shape, d=path_data(moved)))
        if shapes:
            layers.append(replace(layer, shapes=shapes))
    if not layers:
        raise InvalidParameters(
            f"Shrinking by {-distance:g} px leaves no shape.", {"field": "distance"}
        )
    return OffsetShapes(replace(document, layers=layers), offset, removed)
