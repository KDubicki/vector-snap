"""Split shapes along a line on the server: the SVG editor's knife for services and
scripts without a browser.

As in the editor, only shapes the line fully crosses are split (both of its ends lie
outside the shape), so the shape a line starts and ends on, usually the background,
stays whole. With `ids`, only those shapes are split when the line crosses any of them.
Pieces take the shape's place and color, with ids derived from it (`p-3-12.a`,
`p-3-12.b`, ...). Curves of a split shape become polylines. See
docs/05-api-specification.md#post-apiv1svgsplit and docs/08-svg-editor.md#knife-line-cut-.
"""

from collections.abc import Collection, Sequence
from dataclasses import dataclass, replace
from string import ascii_lowercase

from shapely import LineString, MultiPolygon, Point, Polygon
from shapely.ops import split

from app.services.svg_geometry import (
    VectorDocument,
    VectorShape,
    flatten,
    path_data,
    polygons,
    to_polygon,
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
    parts = polygons(to_polygon(flatten(shape.d)))
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


def _split_shapes(
    document: VectorDocument, line: LineString, allowed: Collection[str] | None
) -> SplitSvg:
    taken = {shape.id for layer in document.layers for shape in layer.shapes}
    created: list[str] = []
    split_count = 0
    layers = []
    for layer in document.layers:
        shapes: list[VectorShape] = []
        for shape in layer.shapes:
            cut = None if allowed is not None and shape.id not in allowed else pieces(shape, line)
            if cut is None:
                shapes.append(shape)
                continue
            ids = _piece_ids(shape.id, len(cut), taken)
            shapes.extend(
                replace(shape, id=piece_id, d=path_data(piece))
                for piece_id, piece in zip(ids, cut, strict=True)
            )
            created.extend(ids)
            split_count += 1
        layers.append(replace(layer, shapes=shapes))
    return SplitSvg(replace(document, layers=layers), created, split_count)


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
