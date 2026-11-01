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

from app.services.svg_geometry import (
    VectorDocument,
    VectorShape,
    flatten,
    path_data,
    polygons,
    to_polygon,
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
    wanted = set(ids)
    simplified: list[str] = []
    before = after = 0
    layers = []
    for layer in document.layers:
        shapes: list[VectorShape] = []
        for shape in layer.shapes:
            if wanted and shape.id not in wanted:
                shapes.append(shape)
                continue
            outline = to_polygon(flatten(shape.d))
            simpler = outline.simplify(tolerance, preserve_topology=True)
            points, fewer = outline_points(outline), outline_points(simpler)
            before += points
            if simpler.is_empty or simpler.area <= 0 or fewer >= points:
                after += points
                shapes.append(shape)
                continue
            after += fewer
            simplified.append(shape.id)
            shapes.append(replace(shape, d=path_data(simpler)))
        layers.append(replace(layer, shapes=shapes))
    return SimplifiedSvg(replace(document, layers=layers), simplified, before, after)
