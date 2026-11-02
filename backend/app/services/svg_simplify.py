"""Simplify shape outlines on the server: fewer points for cutting plotters, laser
software and slicers that choke on traced detail, and smaller files.

Every outline is flattened and simplified with Douglas-Peucker within `tolerance`
document px, keeping its topology (holes stay holes, parts do not cross). A shape that
would lose its area keeps its outline. Curves become polylines, as in the knife and
lasso. See docs/05-api-specification.md#post-apiv1svgsimplify.
"""

from collections.abc import Collection
from dataclasses import dataclass, replace

from shapely.geometry.base import BaseGeometry

from app.services.svg_document import edit_shapes
from app.services.svg_geometry import (
    VectorDocument,
    VectorShape,
    path_data,
    polygons,
    shape_outline,
)


@dataclass(frozen=True)
class SimplifiedSvg:
    document: VectorDocument
    simplified: list[str]  # ids of the shapes that lost points, in document order
    points_before: int  # outline points of the shapes asked for, flattened
    points_after: int


def outline_points(geometry: BaseGeometry) -> int:
    """Corners of every ring of a geometry (closing points not counted twice)."""
    return sum(
        len(ring.coords) - 1
        for polygon in polygons(geometry)
        for ring in [polygon.exterior, *polygon.interiors]
    )


def simplify_shapes(
    document: VectorDocument, tolerance: float, ids: Collection[str] = ()
) -> SimplifiedSvg:
    """Simplify the shapes in `ids` (every shape without `ids`) within `tolerance` px."""
    simplified: list[str] = []
    points = {"before": 0, "after": 0}

    def edit(shape: VectorShape) -> VectorShape:
        outline = shape_outline(shape)
        simpler = outline.simplify(tolerance, preserve_topology=True)
        count, fewer = outline_points(outline), outline_points(simpler)
        points["before"] += count
        if simpler.is_empty or simpler.area <= 0 or fewer >= count:
            points["after"] += count
            return shape
        points["after"] += fewer
        simplified.append(shape.id)
        return replace(shape, d=path_data(simpler))

    edited = edit_shapes(document, ids, edit)
    return SimplifiedSvg(edited, simplified, points["before"], points["after"])
