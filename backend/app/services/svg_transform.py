"""Move, scale, flip and rotate shapes on the server: the SVG editor's transforms for
services and scripts without a browser.

Scale, flip and rotation turn around the center of the shapes' bounding box, as in the
editor, and the move comes last. Curves stay curves: the transform is applied to the
control points (quadratic curves become exact cubic ones, arcs cubic approximations).
See docs/05-api-specification.md#post-apiv1svgtransform.
"""

import math
from collections.abc import Collection
from dataclasses import dataclass, replace
from typing import Literal

from shapely import unary_union

from app.core.errors import InvalidParameters
from app.services.svg_geometry import (
    VectorDocument,
    curve_path,
    flatten,
    to_polygon,
)

Flip = Literal["none", "x", "y"]
# SVG matrix (a, b, c, d, e, f): x' = a x + c y + e, y' = b x + d y + f.
Matrix = tuple[float, float, float, float, float, float]


@dataclass(frozen=True)
class TransformedShapes:
    document: VectorDocument
    transformed: list[str]  # ids, in document order


def _then(first: Matrix, second: Matrix) -> Matrix:
    """`first`, then `second`."""
    a1, b1, c1, d1, e1, f1 = first
    a2, b2, c2, d2, e2, f2 = second
    return (
        a2 * a1 + c2 * b1,
        b2 * a1 + d2 * b1,
        a2 * c1 + c2 * d1,
        b2 * c1 + d2 * d1,
        a2 * e1 + c2 * f1 + e2,
        b2 * e1 + d2 * f1 + f2,
    )


def transform_matrix(
    center: tuple[float, float],
    scale: float = 1.0,
    rotate: float = 0.0,
    flip: Flip = "none",
    dx: float = 0.0,
    dy: float = 0.0,
) -> Matrix:
    """Scale, flip, then rotate (degrees, clockwise on screen) around `center`, then move."""
    cx, cy = center
    radians = math.radians(rotate)
    cos, sin = math.cos(radians), math.sin(radians)
    sx = -scale if flip == "x" else scale
    sy = -scale if flip == "y" else scale
    matrix: Matrix = (1, 0, 0, 1, -cx, -cy)
    matrix = _then(matrix, (sx, 0, 0, sy, 0, 0))
    matrix = _then(matrix, (cos, sin, -sin, cos, 0, 0))  # y points down: clockwise
    return _then(matrix, (1, 0, 0, 1, cx + dx, cy + dy))


def _number(value: float) -> str:
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def transform_path(d: str, matrix: Matrix) -> str:
    """Path data with every point transformed by `matrix`."""
    a, b, c, d_, e, f = matrix
    parts = []
    for command, points in curve_path(d):
        moved = (f"{_number(a * x + c * y + e)},{_number(b * x + d_ * y + f)}" for x, y in points)
        parts.append(f"{command}{' '.join(moved)}" if points else command)
    return " ".join(parts)


def transform_shapes(
    document: VectorDocument,
    ids: Collection[str] = (),
    *,
    dx: float = 0.0,
    dy: float = 0.0,
    scale: float = 1.0,
    rotate: float = 0.0,
    flip: Flip = "none",
) -> TransformedShapes:
    """Transform the shapes in `ids` (every shape without `ids`) around their center."""
    wanted = set(ids)
    targets = [
        shape
        for layer in document.layers
        for shape in layer.shapes
        if not wanted or shape.id in wanted
    ]
    if not targets:
        raise InvalidParameters("None of the `ids` is a shape of the SVG.", {"field": "ids"})
    outline = unary_union([to_polygon(flatten(shape.d)) for shape in targets])
    if outline.is_empty:
        raise InvalidParameters("The shapes have no area to transform.", {"field": "ids"})
    left, top, right, bottom = outline.bounds
    matrix = transform_matrix(((left + right) / 2, (top + bottom) / 2), scale, rotate, flip, dx, dy)

    moving = {id(shape) for shape in targets}  # by identity: equal shapes may repeat
    layers = [
        replace(
            layer,
            shapes=[
                replace(shape, d=transform_path(shape.d, matrix)) if id(shape) in moving else shape
                for shape in layer.shapes
            ],
        )
        if any(id(shape) in moving for shape in layer.shapes)
        else layer
        for layer in document.layers
    ]
    return TransformedShapes(replace(document, layers=layers), [shape.id for shape in targets])
