"""Closed triangle meshes of extruded polygons, and binary STL files.

Prisms share the exact ring vertices between caps and walls, so every body is a closed,
consistently oriented mesh — what slicers and 3MF validators expect. See
docs/13-export-formats.md.
"""

import numpy as np
from numpy.typing import NDArray
from shapely import Polygon, constrained_delaunay_triangles, get_coordinates, unary_union
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient

from app.services.svg_geometry import polygons

_TRIANGLE_DTYPE = np.dtype(
    [("normal", "<f4", (3,)), ("vertices", "<f4", (3, 3)), ("attribute", "<u2")]
)


def _at(points: NDArray[np.float64], z: float) -> NDArray[np.float64]:
    return np.concatenate([points, np.full((*points.shape[:-1], 1), z)], axis=-1)


def _cap(polygon: Polygon, z: float, *, up: bool) -> NDArray[np.float64]:
    """Flat triangulation of a polygon with holes at height z, facing up or down.

    GEOS constrained Delaunay triangulation is robust for polygons with many holes and
    reuses the exact ring vertices, so caps and walls share their edges.
    """
    caps = get_coordinates(constrained_delaunay_triangles(polygon)).reshape(-1, 4, 2)[:, :3]
    u, v = caps[:, 1] - caps[:, 0], caps[:, 2] - caps[:, 0]
    clockwise = u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0] < 0
    caps[clockwise] = caps[clockwise][:, [0, 2, 1]]
    return _at(caps if up else caps[:, [0, 2, 1]], z)


def _walls(ring: NDArray[np.float64], bottom: float, top: float) -> NDArray[np.float64]:
    """Side walls of a closed ring; counter-clockwise rings face out, clockwise ones in."""
    start = ring[:-1]
    end = np.roll(start, -1, axis=0)
    a0, b0, a1, b1 = _at(start, bottom), _at(end, bottom), _at(start, top), _at(end, top)
    return np.concatenate([np.stack([a0, b0, b1], axis=1), np.stack([a0, b1, a1], axis=1)])


def _floor(
    polygon: Polygon, bottom: float, pocket: Polygon | None, depth: float
) -> list[NDArray[np.float64]]:
    """Downward bottom face of an oriented polygon, with `pocket` recessed `depth` into it."""
    if pocket is None:
        return [_cap(polygon, bottom, up=False)]
    pocket = orient(pocket, sign=-1.0)  # a hole of the bottom face: clockwise
    floor = Polygon(polygon.exterior, [*polygon.interiors, pocket.exterior])
    return [
        _cap(floor, bottom, up=False),
        _walls(np.asarray(pocket.exterior.coords), bottom, bottom + depth),
        _cap(pocket, bottom + depth, up=False),
    ]


def prism(
    polygon: Polygon, bottom: float, top: float, pocket: Polygon | None = None, depth: float = 0
) -> NDArray[np.float64]:
    """Closed triangle mesh (N x 3 x 3) of a polygon with holes extruded from bottom to top.

    `pocket` (inside the polygon, clear of its holes) is recessed `depth` into the bottom.
    """
    polygon = orient(polygon, sign=1.0)  # exterior counter-clockwise, holes clockwise
    rings = [polygon.exterior, *polygon.interiors]
    parts = [_cap(polygon, top, up=True)]
    parts += [_walls(np.asarray(ring.coords), bottom, top) for ring in rings]
    parts += _floor(polygon, bottom, pocket, depth)
    return np.concatenate(parts)


def footed_prism(
    polygon: Polygon,
    inset: list[Polygon],
    foot: float,
    top: float,
    pocket: Polygon | None = None,
    depth: float = 0,
) -> NDArray[np.float64]:
    """Closed mesh of `polygon` extruded from 0 to `top` whose lowest `foot` mm are only
    the smaller `inset` polygons (inside it, not touching its rings): a stepped bottom.

    One manifold solid — the step is a downward face between the two outlines — so a
    pocket in the bottom may reach above the step. `pocket` is recessed into the inset
    polygon that contains it.
    """
    polygon = orient(polygon, sign=1.0)
    parts = [_cap(polygon, top, up=True)]
    parts += [
        _walls(np.asarray(ring.coords), foot, top)
        for ring in [polygon.exterior, *polygon.interiors]
    ]
    parts += [
        _cap(step, foot, up=False) for step in polygons(polygon.difference(unary_union(inset)))
    ]
    for piece in inset:
        piece = orient(piece, sign=1.0)
        parts += [
            _walls(np.asarray(ring.coords), 0.0, foot)
            for ring in [piece.exterior, *piece.interiors]
        ]
        inside = pocket is not None and pocket.within(piece)
        parts += _floor(piece, 0.0, pocket if inside else None, depth)
    return np.concatenate(parts)


def write_binary_stl(triangles: list[NDArray[np.float64]]) -> bytes:
    vertices = np.concatenate(triangles) if triangles else np.zeros((0, 3, 3))
    data = np.zeros(len(vertices), dtype=_TRIANGLE_DTYPE)
    if len(vertices):
        normals = np.cross(vertices[:, 1] - vertices[:, 0], vertices[:, 2] - vertices[:, 0])
        lengths = np.linalg.norm(normals, axis=1, keepdims=True)
        data["normal"] = np.divide(normals, lengths, out=np.zeros_like(normals), where=lengths > 0)
        data["vertices"] = vertices
    header = b"VectorSnap STL export".ljust(80, b"\0")
    return header + np.uint32(len(vertices)).tobytes() + data.tobytes()


# Inward offset that separates rings touching at a single point (see `without_pinches`):
# far below print resolution, well above float32 STL precision for models up to ~1 m.
PINCH_SEPARATION_MM = 0.002


def has_pinches(shapes: list[Polygon]) -> bool:
    """Whether rings of these polygons share a point: shapes touching at a corner, or a
    hole touching its outline or another hole (all valid polygons in shapely)."""
    seen: set[tuple[float, float]] = set()
    for polygon in shapes:
        for ring in [polygon.exterior, *polygon.interiors]:
            points = {(round(x, 9), round(y, 9)) for x, y in ring.coords[:-1]}
            if not seen.isdisjoint(points):
                return True
            seen |= points
    return False


def without_pinches(geometry: BaseGeometry) -> list[Polygon]:
    """Polygons of `geometry` that extrude into manifold prisms.

    Where rings touch at a single point, the vertical edge there would belong to four
    triangles, which slicers and 3MF validators report as non-manifold. A tiny inward
    offset pulls such rings apart; geometry without pinch points is left exact.
    """
    shapes = polygons(geometry)
    if not has_pinches(shapes):
        return shapes
    return polygons(geometry.buffer(-PINCH_SEPARATION_MM, join_style="mitre"))
