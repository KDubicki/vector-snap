"""The area a stroke paints, for `/svg/import`: the outline drawn with a pen of the
stroke's width, with its caps, joins and dashes, as one filled geometry.

Lucide, Feather, Tabler and the outlined Material icons draw with strokes only
(`fill="none"`), and logos outline their shapes; the contract holds filled areas, so a
stroke becomes the area a browser paints with it. Widths and dash lengths scale with the
element's transform: exactly under moves, rotations, mirrors and even scaling (the
viewBox), by the mean of the two scales under a skew or an uneven scale. See
docs/05-api-specification.md#post-apiv1svgimport.
"""

import math
import re
from collections.abc import Mapping

import numpy as np
import shapely
from numpy.typing import NDArray
from shapely import LinearRing, LineString, Point, Polygon, box, unary_union
from shapely.geometry.base import BaseGeometry

from app.core.errors import SvgTooComplex

# SVG's stroke-linecap and stroke-linejoin as Shapely's buffer styles; values SVG 2
# added that Shapely has no style for fall back to the nearest one.
CAPS = {"butt": "flat", "round": "round", "square": "square"}
JOINS = {
    "miter": "mitre",
    "miter-clip": "mitre",
    "arcs": "round",
    "round": "round",
    "bevel": "bevel",
}
DEFAULT_MITER_LIMIT = 4.0
# Round caps and joins get at least as many segments per quarter circle as Shapely's
# default, more for wide pens, so they stray from the circle by less than the tolerance.
MIN_QUAD_SEGMENTS, MAX_QUAD_SEGMENTS = 8, 64
_SEPARATOR_RE = re.compile(r"[\s,]+")

# A flattened subpath and whether it is closed (svg_geometry.flatten_subpaths).
Line = tuple[NDArray[np.float64], bool]


def _number(value: object, default: float) -> float:
    try:
        number = float(str(value).strip())
    except ValueError:
        return default
    return number if math.isfinite(number) else default


def dash_pattern(value: object, scale: float) -> list[float] | None:
    """`stroke-dasharray` as lengths (dash, gap, dash, ...) scaled to the document, or
    None for a solid stroke: `none`, or what SVG draws solid (a negative or unreadable
    length, a pattern of zero length). An odd list repeats to an even one."""
    text = str(value or "").strip()
    if not text or text == "none":
        return None
    try:
        lengths = [float(part.removesuffix("px")) for part in _SEPARATOR_RE.split(text) if part]
    except ValueError:
        return None
    if not all(math.isfinite(length) and length >= 0 for length in lengths):
        return None
    if not lengths or sum(lengths) <= 0:
        return None
    if len(lengths) % 2:
        lengths *= 2
    return [length * scale for length in lengths]


def _point_at(
    points: NDArray[np.float64], along: NDArray[np.float64], at: float
) -> NDArray[np.float64]:
    index = int(np.clip(np.searchsorted(along, at, side="right") - 1, 0, len(points) - 2))
    span = along[index + 1] - along[index]
    share = 0.0 if span == 0 else (at - along[index]) / span
    return np.asarray(points[index] + (points[index + 1] - points[index]) * share)


def _dashes(
    points: NDArray[np.float64], pattern: list[float], offset: float, limit: int
) -> list[NDArray[np.float64]]:
    """The pieces of a polyline a dash pattern draws, the pattern starting `offset`
    into it; more than `limit` dashes is `SvgTooComplex`."""
    along = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))])
    total = float(along[-1])
    period = sum(pattern)
    if math.ceil(total / period + 1) * (len(pattern) // 2) > limit:
        raise SvgTooComplex(
            f"A dashed stroke has more than {limit} dashes; at most {limit} shapes are accepted.",
            {"max_svg_shapes": limit},
        )
    pieces = []
    position = -(offset % period)
    index = 0
    while position <= total:
        length = pattern[index % len(pattern)]
        if index % 2 == 0 and position + length >= 0:  # a dash (of 0: a dot with caps)
            start, end = max(position, 0.0), min(position + length, total)
            inside = points[
                np.searchsorted(along, start, side="right") : np.searchsorted(
                    along, end, side="left"
                )
            ]
            pieces.append(
                np.vstack([_point_at(points, along, start), inside, _point_at(points, along, end)])
            )
        position += length
        index += 1
    return pieces


def _pen(
    points: NDArray[np.float64],
    closed: bool,
    radius: float,
    style: dict[str, object],
) -> BaseGeometry:
    """What a pen of `radius` paints along one polyline."""
    if len(points) < 2 or not np.any(np.ptp(points, axis=0) > 0):
        # A subpath of no length shows as a dot with round or square caps.
        x, y = points[0]
        if style["cap_style"] == "round":
            return Point(x, y).buffer(radius, quad_segs=style["quad_segs"])
        if style["cap_style"] == "square":
            return box(x - radius, y - radius, x + radius, y + radius)
        return Polygon()
    if closed and len(np.unique(points, axis=0)) >= 3:
        # A closed subpath joins at its start as everywhere else, without caps.
        joins = {key: value for key, value in style.items() if key != "cap_style"}
        return shapely.buffer(LinearRing(points), radius, **joins)
    return shapely.buffer(LineString(points), radius, **style)


def stroke_area(
    lines: list[Line],
    values: Mapping[str, object],
    width: float,
    scale: float,
    tolerance: float,
    limit: int,
) -> BaseGeometry:
    """The area a stroke of `width` (document units) paints along the lines, by the
    element's `values` (stroke-linecap, -linejoin, -miterlimit, -dasharray,
    -dashoffset); dash lengths are multiplied by `scale`. More than `limit` dashes is
    `SvgTooComplex`."""
    radius = width / 2
    segments = MIN_QUAD_SEGMENTS
    if radius > tolerance:
        step = math.acos(1 - tolerance / radius)  # the widest angle within the tolerance
        segments = min(MAX_QUAD_SEGMENTS, max(MIN_QUAD_SEGMENTS, math.ceil(math.pi / 4 / step)))
    style: dict[str, object] = {
        "quad_segs": segments,
        "cap_style": CAPS.get(str(values.get("stroke-linecap") or "").strip(), "flat"),
        "join_style": JOINS.get(str(values.get("stroke-linejoin") or "").strip(), "mitre"),
        "mitre_limit": max(1.0, _number(values.get("stroke-miterlimit"), DEFAULT_MITER_LIMIT)),
    }
    pattern = dash_pattern(values.get("stroke-dasharray"), scale)
    offset = _number(values.get("stroke-dashoffset"), 0.0) * scale
    pens: list[BaseGeometry] = []
    for points, closed in lines:
        if pattern is None:
            pens.append(_pen(points, closed, radius, style))
            continue
        for piece in _dashes(points, pattern, offset, limit - len(pens)):
            pens.append(_pen(piece, False, radius, style))
    return unary_union(pens) if pens else Polygon()
