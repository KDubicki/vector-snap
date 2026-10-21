"""Base plate of 3D exports: its outline around the design, a raised rim, a hanging loop,
a magnet pocket, and the removal of details too thin to print (millimetres).

See docs/13-export-formats.md.
"""

import math
from itertools import pairwise
from typing import Literal

from shapely import (
    Point,
    Polygon,
    box,
    minimum_bounding_circle,
    minimum_bounding_radius,
    unary_union,
)
from shapely.affinity import rotate
from shapely.geometry.base import BaseGeometry
from shapely.ops import nearest_points, polylabel

from app.core.errors import InvalidParameters
from app.services.svg_geometry import polygons

BaseShape = Literal["outline", "rectangle", "rounded", "circle"]
# Side of the base plate the hanging loop sticks out of.
LoopPosition = Literal["top", "right", "bottom", "left"]

# Corner radius of the "rounded" base plate, relative to its shorter side.
ROUNDED_CORNER_RATIO = 0.15
# Share of the largest corner radius that still covers a design reaching into a corner.
CORNER_FIT = 0.98
# Width of the ring around the hanging loop's hole (mm).
LOOP_WALL_MM = 2.0
# Minimum plastic around (and above) a magnet pocket (mm).
MAGNET_WALL_MM = 1.0
MAGNET_ROOF_MM = 0.4
# Segments per quarter circle of round outlines.
QUAD_SEGS = 32


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
        return silhouette.buffer(margin_mm, quad_segs=QUAD_SEGS) if margin_mm > 0 else silhouette
    if shape == "circle":
        center = minimum_bounding_circle(silhouette).centroid
        # The polygon circumscribes the true circle, so no point of the design sticks out.
        radius = (minimum_bounding_radius(silhouette) + margin_mm) / math.cos(
            math.pi / (4 * QUAD_SEGS)
        )
        return Point(center.x, center.y).buffer(radius, quad_segs=QUAD_SEGS)
    minx, miny, maxx, maxy = silhouette.bounds
    rectangle = box(minx - margin_mm, miny - margin_mm, maxx + margin_mm, maxy + margin_mm)
    if shape == "rectangle":
        return rectangle
    # Concentric with a corner of the design's bounding box, so the margin stays even.
    radius = ROUNDED_CORNER_RATIO * min(maxx - minx, maxy - miny) + margin_mm
    rounded = _rounded(rectangle, radius)
    if rounded.covers(silhouette):
        return rounded
    # The design reaches into a corner: a corner radius r keeps the bounding box corner
    # (margin m inside the plate's corner) covered while (r - m)·√2 ≤ r, i.e. up to
    # (2 + √2)·m; a little less, as the arc is approximated by a polygon inside it.
    radius = min(radius, CORNER_FIT * (2 + math.sqrt(2)) * margin_mm)
    return _rounded(rectangle, radius) if radius > 0 else rectangle


def _rounded(rectangle: Polygon, radius: float) -> BaseGeometry:
    return rectangle.buffer(-radius, join_style="mitre").buffer(radius, quad_segs=QUAD_SEGS)


def rim(outline: BaseGeometry, width_mm: float) -> BaseGeometry:
    """Band `width_mm` wide along the inside of the base plate's `outline` (millimetres).

    Raised above the plate, it frames the design like the edge of a coaster or a sign. It
    follows outer edges only: holes in the plate stay open without a rim of their own.
    Empty when no rim is requested.
    """
    if width_mm <= 0 or outline.is_empty:
        return Polygon()
    shells = unary_union([Polygon(part.exterior) for part in polygons(outline)])
    band = shells.difference(shells.buffer(-width_mm, quad_segs=QUAD_SEGS))
    return band.intersection(outline)


# Rotation (degrees, counterclockwise) that turns each side of the plate to the top.
LOOP_TURNS: dict[LoopPosition, float] = {"top": 0, "right": 90, "bottom": 180, "left": -90}


def with_loop(
    outline: BaseGeometry, hole_mm: float, position: LoopPosition = "top"
) -> BaseGeometry:
    """Add a ring with a `hole_mm` hole beyond the `position` side of `outline` (mm).

    The ring is centered on that side, as close to its middle as possible, and reaches
    half a wall into the outline, so it is joined to the plate; the hole starts just
    beyond the outline and never cuts into the design.
    """
    if hole_mm <= 0 or outline.is_empty:
        return outline
    turn = LOOP_TURNS[position]
    if turn:
        # The loop is added on top of the turned outline, then turned back with it.
        pivot = outline.centroid
        return rotate(with_loop(rotate(outline, turn, origin=pivot), hole_mm), -turn, origin=pivot)
    minx, _, maxx, maxy = outline.bounds
    top = outline.intersection(box(minx, maxy - LOOP_WALL_MM / 2, maxx, maxy))
    anchor = nearest_points(top, Point((minx + maxx) / 2, maxy))[0]
    radius = hole_mm / 2
    center = Point(anchor.x, maxy + radius)
    ring = center.buffer(radius + LOOP_WALL_MM, quad_segs=QUAD_SEGS)
    return outline.union(ring).difference(center.buffer(radius, quad_segs=QUAD_SEGS))


def magnet_pocket(outline: BaseGeometry, diameter_mm: float, count: int = 1) -> BaseGeometry | None:
    """Round pockets for `count` magnets in the largest base polygon: one in its widest
    spot, several in the widest spot of equal slices along its longer side.

    None when no magnet is requested; raises when the plate has no room for them.
    """
    if diameter_mm <= 0:
        return None
    parts = polygons(outline)
    if not parts:
        return None
    largest = max(parts, key=lambda part: part.area)
    if count > 1:
        return _magnet_row(largest, diameter_mm, count)
    center = polylabel(largest, tolerance=0.01)
    room = largest.boundary.distance(center)
    radius = diameter_mm / 2
    if room < radius + MAGNET_WALL_MM:
        raise InvalidParameters(
            f"No room for a {diameter_mm:g} mm magnet: the base plate fits at most "
            f"{max(0.0, 2 * (room - MAGNET_WALL_MM)):.1f} mm.",
            {"field": "magnet_mm"},
        )
    return center.buffer(radius, quad_segs=QUAD_SEGS)


def _magnet_row(plate: Polygon, diameter_mm: float, count: int) -> BaseGeometry:
    """`count` pockets, one in the widest spot of each equal slice of `plate` along its
    longer side, each with a wall to the edge and to its neighbours."""
    minx, miny, maxx, maxy = plate.bounds
    wide = maxx - minx >= maxy - miny
    step = ((maxx - minx) if wide else (maxy - miny)) / count
    radius = diameter_mm / 2
    centers: list[Point] = []
    for index in range(count):
        start = (minx if wide else miny) + index * step
        strip = (
            box(start, miny, start + step, maxy) if wide else box(minx, start, maxx, start + step)
        )
        pieces = polygons(plate.intersection(strip))
        if pieces:
            centers.append(polylabel(max(pieces, key=lambda part: part.area), tolerance=0.01))
    roomy = len(centers) == count and all(
        plate.boundary.distance(center) >= radius + MAGNET_WALL_MM for center in centers
    )
    apart = all(
        first.distance(second) >= diameter_mm + MAGNET_WALL_MM
        for first, second in pairwise(centers)
    )
    if not (roomy and apart):
        raise InvalidParameters(
            f"No room for {count} magnets of {diameter_mm:g} mm side by side: use fewer or "
            "smaller magnets, or a larger plate.",
            {"field": "magnet_count"},
        )
    return unary_union([center.buffer(radius, quad_segs=QUAD_SEGS) for center in centers])
