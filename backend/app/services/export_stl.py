"""Export a vector document as a 3D model (binary STL) for printing.

Each color layer is extruded to its own height on top of an optional base plate, so a
multi-color design prints as a relief (or, with `layered=False`, all colors share one
height). Coordinates are converted to millimetres and the y axis is flipped (SVG y points
down, STL z-up models are viewed from above with y up). See docs/13-export-formats.md.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from shapely import (
    Polygon,
    affinity,
    constrained_delaunay_triangles,
    get_coordinates,
    unary_union,
)
from shapely.geometry.polygon import orient

from app.services.svg_geometry import VectorDocument, flatten, polygons, to_polygon

_TRIANGLE_DTYPE = np.dtype(
    [("normal", "<f4", (3,)), ("vertices", "<f4", (3, 3)), ("attribute", "<u2")]
)


# Drops near-collinear points left by flattening (straight edges traced as curves);
# in document px, i.e. far below print resolution.
SIMPLIFY_TOLERANCE = 0.05


@dataclass(frozen=True)
class StlOptions:
    width_mm: float = 100.0
    base_mm: float = 1.0
    layer_mm: float = 1.0
    layered: bool = True


def _prism(polygon: Polygon, bottom: float, top: float) -> NDArray[np.float64]:
    """Closed triangle mesh (N x 3 x 3) of a polygon with holes extruded from bottom to top.

    Caps use GEOS constrained Delaunay triangulation, which is robust for polygons with
    many holes and reuses the exact ring vertices, so caps and walls share their edges.
    """
    polygon = orient(polygon, sign=1.0)  # exterior counter-clockwise, holes clockwise
    caps = get_coordinates(constrained_delaunay_triangles(polygon)).reshape(-1, 4, 2)[:, :3]
    u, v = caps[:, 1] - caps[:, 0], caps[:, 2] - caps[:, 0]
    clockwise = u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0] < 0
    caps[clockwise] = caps[clockwise][:, [0, 2, 1]]

    def at(points: NDArray[np.float64], z: float) -> NDArray[np.float64]:
        return np.concatenate([points, np.full((*points.shape[:-1], 1), z)], axis=-1)

    parts = [at(caps, top), at(caps[:, [0, 2, 1]], bottom)]
    for ring in [polygon.exterior, *polygon.interiors]:
        start = np.asarray(ring.coords)[:-1]
        end = np.roll(start, -1, axis=0)
        a0, b0, a1, b1 = at(start, bottom), at(end, bottom), at(start, top), at(end, top)
        parts += [np.stack([a0, b0, b1], axis=1), np.stack([a0, b1, a1], axis=1)]
    return np.concatenate(parts)


def _write_binary_stl(triangles: list[NDArray[np.float64]]) -> bytes:
    vertices = np.concatenate(triangles) if triangles else np.zeros((0, 3, 3))
    data = np.zeros(len(vertices), dtype=_TRIANGLE_DTYPE)
    if len(vertices):
        normals = np.cross(vertices[:, 1] - vertices[:, 0], vertices[:, 2] - vertices[:, 0])
        lengths = np.linalg.norm(normals, axis=1, keepdims=True)
        data["normal"] = np.divide(normals, lengths, out=np.zeros_like(normals), where=lengths > 0)
        data["vertices"] = vertices
    header = b"VectorSnap STL export".ljust(80, b"\0")
    return header + np.uint32(len(vertices)).tobytes() + data.tobytes()


def export_stl(document: VectorDocument, options: StlOptions) -> bytes:
    """Extrude every color layer and return a binary STL (units: millimetres)."""
    scale = options.width_mm / document.width

    def to_mm(geometry: Polygon) -> Polygon:
        flipped = affinity.scale(geometry, xfact=1, yfact=-1, origin=(0, document.height / 2))
        return affinity.scale(flipped, xfact=scale, yfact=scale, origin=(0, 0))

    layer_shapes = [
        unary_union([to_polygon(flatten(shape.d)) for shape in layer.shapes]).simplify(
            SIMPLIFY_TOLERANCE
        )
        for layer in document.layers
    ]

    triangles: list[NDArray[np.float64]] = []
    if options.base_mm > 0:
        for polygon in polygons(unary_union(layer_shapes)):
            triangles.append(_prism(to_mm(polygon), 0.0, options.base_mm))
    for position, geometry in enumerate(layer_shapes):
        steps = position + 1 if options.layered else 1
        top = options.base_mm + options.layer_mm * steps
        for polygon in polygons(geometry):
            triangles.append(_prism(to_mm(polygon), options.base_mm, top))
    return _write_binary_stl(triangles)
