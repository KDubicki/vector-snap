"""Export a vector document as a 3D model (binary STL) for printing.

Each color layer is extruded to its own height on top of an optional base plate, so a
multi-color design prints as a relief (or, with `layered=False`, all colors share one
height). Heights can be set per color (0 leaves a color out) and the model mirrored;
details thinner than the nozzle can be removed before extrusion.
Coordinates are converted to millimetres and the y axis is flipped (SVG y points down,
STL z-up models are viewed from above with y up). See docs/13-export-formats.md.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray
from shapely import (
    Polygon,
    affinity,
    constrained_delaunay_triangles,
    get_coordinates,
    unary_union,
)
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient

from app.core.errors import InvalidParameters
from app.services.svg_geometry import (
    VectorDocument,
    layer_geometries,
    polygons,
    to_millimetres,
)

_TRIANGLE_DTYPE = np.dtype(
    [("normal", "<f4", (3,)), ("vertices", "<f4", (3, 3)), ("attribute", "<u2")]
)


@dataclass(frozen=True)
class StlOptions:
    width_mm: float = 100.0
    base_mm: float = 1.0
    layer_mm: float = 1.0
    layered: bool = True
    # Height above the base per palette index (mm); 0 leaves the color out. Colors not
    # listed follow `layer_mm` / `layered`.
    layer_heights: Mapping[int, float] = field(default_factory=dict)
    # Mirror horizontally (stamps, printing the top face down).
    mirror: bool = False
    # Remove parts narrower than this (mm), e.g. the nozzle width; 0 keeps everything.
    min_feature_mm: float = 0.0


@dataclass(frozen=True)
class Body:
    """One printable part: the base plate or the extrusion of one color layer."""

    name: str
    color: str  # "#rrggbb"; the base plate uses the bottom layer's color
    triangles: NDArray[np.float64]  # N x 3 x 3, millimetres


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


def printable(geometry: BaseGeometry, min_feature_mm: float) -> BaseGeometry:
    """Drop every part of `geometry` narrower than `min_feature_mm`.

    Morphological opening: shrinking by half the width removes thin lines, slivers and
    specks entirely; growing back restores everything else. Mitred joins keep the
    corners of the remaining shapes sharp.
    """
    if min_feature_mm <= 0:
        return geometry
    radius = min_feature_mm / 2
    shrunk = geometry.buffer(-radius, join_style="mitre")
    return shrunk.buffer(radius, join_style="mitre").intersection(geometry)


def layer_height(position: int, palette_index: int, options: StlOptions) -> float:
    """Extrusion height above the base for the layer at `position` (bottom = 0)."""
    if palette_index in options.layer_heights:
        return options.layer_heights[palette_index]
    return options.layer_mm * (position + 1 if options.layered else 1)


def build_bodies(document: VectorDocument, options: StlOptions) -> list[Body]:
    """Base plate (under the included colors) and one extruded body per color layer."""
    layers = [
        (layer, to_millimetres(geometry, document, options.width_mm))
        for layer, geometry in zip(document.layers, layer_geometries(document), strict=True)
    ]
    if options.mirror:
        width = options.width_mm
        layers = [
            (layer, affinity.scale(geometry, xfact=-1, yfact=1, origin=(width / 2, 0)))
            for layer, geometry in layers
        ]

    included = [
        (layer, geometry, layer_height(position, layer.palette_index, options))
        for position, (layer, geometry) in enumerate(layers)
        if layer_height(position, layer.palette_index, options) > 0
    ]
    if not included:
        raise InvalidParameters("Nothing to export: every color has height 0.")

    bodies: list[Body] = []
    if options.base_mm > 0:
        silhouette = printable(
            unary_union([geometry for _, geometry, _ in included]), options.min_feature_mm
        )
        parts = [_prism(polygon, 0.0, options.base_mm) for polygon in polygons(silhouette)]
        if parts:
            bodies.append(Body("base", included[0][0].fill, np.concatenate(parts)))
    for layer, geometry, height in included:
        top = options.base_mm + height
        shapes = polygons(printable(geometry, options.min_feature_mm))
        parts = [_prism(polygon, options.base_mm, top) for polygon in shapes]
        if parts:
            bodies.append(Body(f"color-{layer.palette_index}", layer.fill, np.concatenate(parts)))
    if not bodies:
        raise InvalidParameters(
            f"Nothing to export: every shape is thinner than {options.min_feature_mm:g} mm.",
            {"field": "min_feature_mm"},
        )
    return bodies


def export_stl(document: VectorDocument, options: StlOptions) -> bytes:
    """Extrude every color layer and return a binary STL (units: millimetres)."""
    return _write_binary_stl([body.triangles for body in build_bodies(document, options)])
