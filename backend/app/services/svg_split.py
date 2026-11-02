"""Split shapes along a line or cut a region out of them on the server: the SVG editor's
knife and lasso for services and scripts without a browser.

As in the editor, only shapes the line fully crosses are split (both of its ends lie
outside the shape), so the shape a line starts and ends on, usually the background,
stays whole. With `ids`, only those shapes are split when the line crosses any of them.
The lasso cuts a closed region out of the shapes it partly covers: the given `ids`, or
the topmost shape under the region's first point, as the editor without a selection.
Pieces take the shape's place and color, with ids derived from it (`p-3-12.a`,
`p-3-12.b`, ...), inside pieces first. Curves of a cut shape become polylines. See
docs/05-api-specification.md#post-apiv1svgsplit and #post-apiv1svglasso, and
docs/08-svg-editor.md#knife-line-cut-.
"""

from collections.abc import Collection, Sequence
from dataclasses import dataclass, replace
from string import ascii_lowercase

from shapely import LineString, MultiPolygon, Point, Polygon, make_valid
from shapely.geometry.base import BaseGeometry
from shapely.ops import split

from app.core.errors import InvalidParameters
from app.services.svg_document import Edited, edit_shapes
from app.services.svg_geometry import (
    VectorDocument,
    VectorShape,
    path_data,
    polygons,
    shape_outline,
)

# Pieces smaller than this (document px²) are numeric slivers, as in the editor.
MIN_PIECE_AREA = 0.5


@dataclass(frozen=True)
class SplitSvg:
    document: VectorDocument
    created: list[str]  # ids of the pieces, in document order
    split: int  # shapes that were split


def pieces(shape: VectorShape, line: LineString) -> list[Polygon] | None:
    """The pieces the line cuts a shape into, or None when it does not fully cross it."""
    parts = polygons(shape_outline(shape))
    if not parts:
        return None
    geometry = MultiPolygon(parts)
    ends = [Point(line.coords[0]), Point(line.coords[-1])]
    if any(geometry.covers(end) for end in ends):
        return None
    cut = [
        piece
        for part in split(geometry, line).geoms
        for piece in polygons(part)
        if piece.area >= MIN_PIECE_AREA
    ]
    # Parts the line misses come back as they were: a split makes more pieces than parts.
    return cut if len(cut) > len(parts) else None


def _piece_ids(shape_id: str, count: int, taken: set[str]) -> list[str]:
    ids: list[str] = []
    number = 0
    while len(ids) < count:
        suffix = ascii_lowercase[number] if number < len(ascii_lowercase) else f"p{number}"
        candidate = f"{shape_id}.{suffix}"
        if candidate not in taken:
            ids.append(candidate)
            taken.add(candidate)
        number += 1
    return ids


def _replaced(shape: VectorShape, ids: list[str], parts: list[Polygon]) -> list[VectorShape]:
    """Pieces of a shape with its color, under the given ids."""
    return [
        replace(shape, id=piece_id, d=path_data(part))
        for piece_id, part in zip(ids, parts, strict=True)
    ]


def _split_shapes(
    document: VectorDocument, line: LineString, allowed: Collection[str] | None
) -> SplitSvg:
    taken = {shape.id for layer in document.layers for shape in layer.shapes}
    created: list[str] = []
    split_ids: list[str] = []

    def edit(shape: VectorShape) -> Edited:
        cut = pieces(shape, line)
        if cut is None:
            return shape
        ids = _piece_ids(shape.id, len(cut), taken)
        created.extend(ids)
        split_ids.append(shape.id)
        return _replaced(shape, ids, cut)

    edited = edit_shapes(document, allowed or (), edit)
    return SplitSvg(edited, created, len(split_ids))


def split_along_line(
    document: VectorDocument, line: Sequence[tuple[float, float]], ids: Collection[str] = ()
) -> SplitSvg:
    """Split the shapes `line` (document px, at least two points) fully crosses: those in
    `ids` when it crosses any of them, otherwise every one."""
    knife = LineString(line)
    if ids:
        restricted = _split_shapes(document, knife, set(ids))
        if restricted.split:
            return restricted
    return _split_shapes(document, knife, None)


@dataclass(frozen=True)
class LassoCut:
    document: VectorDocument
    inside: list[str]  # ids of the pieces inside the region, in document order
    outside: list[str]  # ids of the pieces outside it
    cut: int  # shapes that were cut


def _geometry(shape: VectorShape) -> MultiPolygon:
    return MultiPolygon(polygons(shape_outline(shape)))


def _pieces_of(geometry: BaseGeometry) -> list[Polygon]:
    return [piece for piece in polygons(geometry) if piece.area >= MIN_PIECE_AREA]


def region_pieces(
    shape: VectorShape, region: BaseGeometry
) -> tuple[list[Polygon], list[Polygon]] | None:
    """The pieces of a shape inside and outside the region, or None when the region does
    not cover part of it (it misses the shape or holds all of it)."""
    geometry = _geometry(shape)
    inside = _pieces_of(geometry.intersection(region))
    outside = _pieces_of(geometry.difference(region))
    return (inside, outside) if inside and outside else None


def _shape_under(document: VectorDocument, point: tuple[float, float]) -> str | None:
    """The topmost shape covering a point, as a click in the editor finds it."""
    for layer in reversed(document.layers):
        for shape in reversed(layer.shapes):
            if _geometry(shape).covers(Point(point)):
                return shape.id
    return None


def cut_region(
    document: VectorDocument, region: Sequence[tuple[float, float]], ids: Collection[str] = ()
) -> LassoCut:
    """Cut the closed `region` (document px, at least three points) out of the shapes in
    `ids`, or out of the topmost shape under its first point without `ids`."""
    area = make_valid(Polygon(region))
    if area.area < MIN_PIECE_AREA:
        raise InvalidParameters("The region encloses no area.", {"field": "region"})
    targets = set(ids)
    if not targets:
        under = _shape_under(document, region[0])
        targets = {under} if under is not None else set()

    if not targets:
        return LassoCut(document, [], [], 0)

    taken = {shape.id for layer in document.layers for shape in layer.shapes}
    inside: list[str] = []
    outside: list[str] = []
    cut: list[str] = []

    def edit(shape: VectorShape) -> Edited:
        pieces = region_pieces(shape, area)
        if pieces is None:
            return shape
        parts = [*pieces[0], *pieces[1]]
        piece_ids = _piece_ids(shape.id, len(parts), taken)
        inside.extend(piece_ids[: len(pieces[0])])
        outside.extend(piece_ids[len(pieces[0]) :])
        cut.append(shape.id)
        return _replaced(shape, piece_ids, parts)

    return LassoCut(edit_shapes(document, targets, edit), inside, outside, len(cut))
