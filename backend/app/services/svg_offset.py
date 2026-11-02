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
from app.services.svg_document import edit_shapes
from app.services.svg_geometry import (
    VectorDocument,
    VectorShape,
    path_data,
    shape_outline,
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
    join_style = "round" if corners == "round" else "mitre"
    offset: list[str] = []
    removed: list[str] = []

    def edit(shape: VectorShape) -> VectorShape | None:
        moved = shape_outline(shape).buffer(distance, quad_segs=8, join_style=join_style)
        if moved.is_empty or moved.area < MIN_AREA:
            removed.append(shape.id)
            return None
        offset.append(shape.id)
        return replace(shape, d=path_data(moved))

    edited = edit_shapes(document, ids, edit)
    if not edited.layers:
        raise InvalidParameters(
            f"Shrinking by {-distance:g} px leaves no shape.", {"field": "distance"}
        )
    return OffsetShapes(edited, offset, removed)
