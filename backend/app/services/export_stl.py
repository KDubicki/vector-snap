"""Export a vector document as a 3D model (binary STL) for printing.

Each color layer is extruded to its own height on top of an optional base plate, so a
multi-color design prints as a relief (or, with `layered=False`, all colors share one
height). Heights can be set per color (0 leaves a color out) and the model mirrored;
details thinner than the nozzle can be removed before extrusion, and heights can be
rounded to whole printer layers. The base plate follows the design's outline or is a
rectangle, rounded rectangle or circle around it; colors can be stacked in document order
or by brightness. A hanging loop can be added at the top of the base plate and a magnet
pocket in its underside.
Coordinates are converted to millimetres and the y axis is flipped (SVG y points down,
STL z-up models are viewed from above with y up). See docs/13-export-formats.md.
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from shapely import (
    Point,
    Polygon,
    affinity,
    box,
    constrained_delaunay_triangles,
    get_coordinates,
    make_valid,
    minimum_bounding_circle,
    minimum_bounding_radius,
    unary_union,
)
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient
from shapely.ops import nearest_points, polylabel

from app.core.errors import InvalidParameters
from app.services.svg_geometry import (
    VectorDocument,
    layer_geometries,
    polygons,
    to_millimetres,
)

BaseShape = Literal["outline", "rectangle", "rounded", "circle"]
# Bottom-to-top order of the color layers: as in the SVG (largest coverage at the bottom)
# or by brightness, and a hanging loop can be added at the top of the base plate.
StackOrder = Literal["document", "light_to_dark", "dark_to_light"]

# Corner radius of the "rounded" base plate, relative to its shorter side.
ROUNDED_CORNER_RATIO = 0.15
# Width of the ring around the hanging loop's hole (mm).
LOOP_WALL_MM = 2.0
# Minimum plastic around (and above) a magnet pocket (mm).
MAGNET_WALL_MM = 1.0
MAGNET_ROOF_MM = 0.4
# Segments per quarter circle of round outlines.
_QUAD_SEGS = 32

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
    # Printer layer height (mm): the base and every color end on a layer boundary; 0 = off.
    print_layer_mm: float = 0.0
    # Shape of the base plate and how far it extends beyond the design (mm).
    base_shape: BaseShape = "outline"
    base_margin_mm: float = 0.0
    stack_order: StackOrder = "document"
    # Hole diameter of a hanging loop on top of the base plate (keyrings, hooks); 0 = none.
    loop_hole_mm: float = 0.0
    # Round pocket in the underside of the base plate for a magnet (diameter, depth; mm).
    magnet_mm: float = 0.0
    magnet_depth_mm: float = 2.0


@dataclass(frozen=True)
class Body:
    """One printable part: the base plate or the extrusion of one color layer."""

    name: str
    color: str  # "#rrggbb"; the base plate uses the bottom layer's color
    triangles: NDArray[np.float64]  # N x 3 x 3, millimetres


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


def _prism(
    polygon: Polygon, bottom: float, top: float, pocket: Polygon | None = None, depth: float = 0
) -> NDArray[np.float64]:
    """Closed triangle mesh (N x 3 x 3) of a polygon with holes extruded from bottom to top.

    `pocket` (inside the polygon, clear of its holes) is recessed `depth` into the bottom.
    """
    polygon = orient(polygon, sign=1.0)  # exterior counter-clockwise, holes clockwise
    rings = [polygon.exterior, *polygon.interiors]
    parts = [_cap(polygon, top, up=True)]
    parts += [_walls(np.asarray(ring.coords), bottom, top) for ring in rings]
    if pocket is None:
        parts.append(_cap(polygon, bottom, up=False))
    else:
        pocket = orient(pocket, sign=-1.0)  # a hole of the bottom face: clockwise
        floor = Polygon(polygon.exterior, [*polygon.interiors, pocket.exterior])
        parts += [
            _cap(floor, bottom, up=False),
            _walls(np.asarray(pocket.exterior.coords), bottom, bottom + depth),
            _cap(pocket, bottom + depth, up=False),
        ]
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


def base_outline(silhouette: BaseGeometry, shape: BaseShape, margin_mm: float) -> BaseGeometry:
    """Footprint of the base plate around the design's `silhouette` (millimetres).

    `outline` follows the design (grown by the margin with round joins, like a sticker
    border); the other shapes enclose the whole design plus the margin, filling gaps and
    transparent areas.
    """
    if silhouette.is_empty:
        return silhouette
    if shape == "outline":
        return silhouette.buffer(margin_mm, quad_segs=_QUAD_SEGS) if margin_mm > 0 else silhouette
    if shape == "circle":
        center = minimum_bounding_circle(silhouette).centroid
        # The polygon circumscribes the true circle, so no point of the design sticks out.
        radius = (minimum_bounding_radius(silhouette) + margin_mm) / math.cos(
            math.pi / (4 * _QUAD_SEGS)
        )
        return Point(center.x, center.y).buffer(radius, quad_segs=_QUAD_SEGS)
    minx, miny, maxx, maxy = silhouette.bounds
    rectangle = box(minx - margin_mm, miny - margin_mm, maxx + margin_mm, maxy + margin_mm)
    if shape == "rectangle":
        return rectangle
    # Concentric with a corner of the design's bounding box, so the margin stays even.
    radius = ROUNDED_CORNER_RATIO * min(maxx - minx, maxy - miny) + margin_mm
    return rectangle.buffer(-radius, join_style="mitre").buffer(radius, quad_segs=_QUAD_SEGS)


def with_loop(outline: BaseGeometry, hole_mm: float) -> BaseGeometry:
    """Add a ring with a `hole_mm` hole above the top of `outline` (millimetres).

    The ring is centered on the outline's top, as close to the middle as possible, and
    reaches half a wall into it, so it is joined to the plate; the hole starts just above
    the outline and never cuts into the design.
    """
    if hole_mm <= 0 or outline.is_empty:
        return outline
    minx, _, maxx, maxy = outline.bounds
    top = outline.intersection(box(minx, maxy - LOOP_WALL_MM / 2, maxx, maxy))
    anchor = nearest_points(top, Point((minx + maxx) / 2, maxy))[0]
    radius = hole_mm / 2
    center = Point(anchor.x, maxy + radius)
    ring = center.buffer(radius + LOOP_WALL_MM, quad_segs=_QUAD_SEGS)
    return outline.union(ring).difference(center.buffer(radius, quad_segs=_QUAD_SEGS))


def magnet_pocket(outline: BaseGeometry, diameter_mm: float) -> Polygon | None:
    """Round pocket for a magnet in the widest spot of the largest base polygon.

    None when no magnet is requested; raises when the plate has no spot wide enough.
    """
    if diameter_mm <= 0:
        return None
    parts = polygons(outline)
    if not parts:
        return None
    largest = max(parts, key=lambda part: part.area)
    center = polylabel(largest, tolerance=0.01)
    room = largest.boundary.distance(center)
    radius = diameter_mm / 2
    if room < radius + MAGNET_WALL_MM:
        raise InvalidParameters(
            f"No room for a {diameter_mm:g} mm magnet: the base plate fits at most "
            f"{max(0.0, 2 * (room - MAGNET_WALL_MM)):.1f} mm.",
            {"field": "magnet_mm"},
        )
    return center.buffer(radius, quad_segs=_QUAD_SEGS)


def relative_luminance(hex_color: str) -> float:
    """WCAG relative luminance of a `#rrggbb` color: 0 (black) to 1 (white)."""
    channels = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def stack_layers[T](layers: list[T], fills: list[str], order: StackOrder) -> list[T]:
    """`layers` bottom to top in `order`; equally bright colors keep the document order."""
    if order == "document":
        return layers
    sign = 1 if order == "dark_to_light" else -1
    ranked = sorted(range(len(layers)), key=lambda i: sign * relative_luminance(fills[i]))
    return [layers[i] for i in ranked]


def snap_to_layers(height: float, print_layer_mm: float) -> float:
    """Round a positive height to whole printer layers, keeping at least one layer.

    Heights of 0 stay 0 (no base / color left out); `print_layer_mm` 0 disables snapping.
    """
    if print_layer_mm <= 0 or height <= 0:
        return height
    # Half up, with a little slack for float error (0.3 / 0.2 = 1.4999...).
    layers = max(1, math.floor(height / print_layer_mm + 0.5 + 1e-9))
    return round(layers * print_layer_mm, 6)


def base_height(options: StlOptions) -> float:
    return snap_to_layers(options.base_mm, options.print_layer_mm)


def layer_height(position: int, palette_index: int, options: StlOptions) -> float:
    """Extrusion height above the base for the layer at `position` (bottom = 0)."""
    if palette_index in options.layer_heights:
        height = options.layer_heights[palette_index]
    else:
        height = options.layer_mm * (position + 1 if options.layered else 1)
    return snap_to_layers(height, options.print_layer_mm)


# Inward offset that separates rings touching at a single point (see `_without_pinches`):
# far below print resolution, well above float32 STL precision for models up to ~1 m.
PINCH_SEPARATION_MM = 0.002


def _has_pinches(shapes: list[Polygon]) -> bool:
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


def _without_pinches(geometry: BaseGeometry) -> list[Polygon]:
    """Polygons of `geometry` that extrude into manifold prisms.

    Where rings touch at a single point, the vertical edge there would belong to four
    triangles, which slicers and 3MF validators report as non-manifold. A tiny inward
    offset pulls such rings apart; geometry without pinch points is left exact.
    """
    shapes = polygons(geometry)
    if not _has_pinches(shapes):
        return shapes
    return polygons(geometry.buffer(-PINCH_SEPARATION_MM, join_style="mitre"))


def _repaired(geometry: BaseGeometry) -> BaseGeometry:
    """Valid geometry: scaling rounds coordinates, which can make nearly touching rings
    (e.g. chains of sliver holes) cross; GEOS cannot triangulate such polygons."""
    return geometry if geometry.is_valid else make_valid(geometry)


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
    layers = [(layer, _repaired(geometry)) for layer, geometry in layers]
    layers = stack_layers(layers, [layer.fill for layer, _ in layers], options.stack_order)

    included = [
        (layer, geometry, layer_height(position, layer.palette_index, options))
        for position, (layer, geometry) in enumerate(layers)
        if layer_height(position, layer.palette_index, options) > 0
    ]
    if not included:
        raise InvalidParameters("Nothing to export: every color has height 0.")

    base = base_height(options)
    if options.loop_hole_mm > 0 and base <= 0:
        raise InvalidParameters(
            "A hanging loop needs a base plate (base_mm > 0).", {"field": "loop_hole_mm"}
        )
    if options.magnet_mm > 0 and options.magnet_depth_mm > base - MAGNET_ROOF_MM + 1e-9:
        raise InvalidParameters(
            f"A {options.magnet_depth_mm:g} mm deep magnet pocket needs a base plate of at "
            f"least {options.magnet_depth_mm + MAGNET_ROOF_MM:g} mm.",
            {"field": "magnet_depth_mm"},
        )
    bodies: list[Body] = []
    if base > 0:
        silhouette = printable(
            unary_union([geometry for _, geometry, _ in included]), options.min_feature_mm
        )
        silhouette = base_outline(silhouette, options.base_shape, options.base_margin_mm)
        silhouette = with_loop(silhouette, options.loop_hole_mm)
        pocket = magnet_pocket(silhouette, options.magnet_mm)
        parts = [
            _prism(polygon, 0.0, base, pocket, options.magnet_depth_mm)
            if pocket is not None and pocket.within(polygon)
            else _prism(polygon, 0.0, base)
            for polygon in _without_pinches(silhouette)
        ]
        if parts:
            bodies.append(Body("base", included[0][0].fill, np.concatenate(parts)))
    for layer, geometry, height in included:
        top = base + height
        shapes = _without_pinches(printable(geometry, options.min_feature_mm))
        parts = [_prism(polygon, base, top) for polygon in shapes]
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
    return write_binary_stl([body.triangles for body in build_bodies(document, options)])
