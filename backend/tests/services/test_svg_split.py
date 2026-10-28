import pytest
from shapely import LineString

from app.services.svg_geometry import VectorDocument, VectorShape, flatten, parse_svg, to_polygon
from app.services.svg_split import pieces, split_along_line
from tests.vectors import contract_svg

# White background, two red squares side by side; the second has its own blue color.
DOC = parse_svg(
    contract_svg(
        40,
        20,
        [
            ("#ffffff", ["M0,0 H40 V20 H0 Z"]),
            ("#ff0000", ["M10,5 h10 v10 h-10 z", "M25,5 h10 v10 h-10 z"]),
        ],
    ).replace(b'id="p-1-1"', b'id="p-1-1" fill="#0000ff"')
)


def _shapes(document: VectorDocument) -> dict[str, VectorShape]:
    return {shape.id: shape for layer in document.layers for shape in layer.shapes}


def _area(shape: VectorShape) -> float:
    return float(to_polygon(flatten(shape.d)).area)


def test_splits_fully_crossed_shapes_and_keeps_the_background() -> None:
    result = split_along_line(DOC, [(5, 10), (38, 10)])

    assert result.split == 2
    assert result.created == ["p-1-0.a", "p-1-0.b", "p-1-1.a", "p-1-1.b"]
    shapes = _shapes(result.document)
    assert [shape.id for shape in result.document.layers[1].shapes] == result.created
    assert shapes["p-0-0"] == _shapes(DOC)["p-0-0"]
    assert [_area(shapes[i]) for i in result.created] == pytest.approx([50, 50, 50, 50])
    assert shapes["p-1-1.a"].fill == "#0000ff"  # own colors carry over


def test_a_line_ending_inside_a_shape_does_not_split_it() -> None:
    result = split_along_line(DOC, [(5, 10), (15, 10)])

    assert result.split == 0
    assert result.document == DOC


def test_splits_only_the_given_shapes_when_the_line_crosses_them() -> None:
    line = [(5, 10), (38, 10)]

    assert split_along_line(DOC, line, ["p-1-1"]).created == ["p-1-1.a", "p-1-1.b"]
    # Crossing none of them: every fully crossed shape, as in the editor.
    assert split_along_line(DOC, [(5, 2), (5, 18)], ["p-0-0"]).split == 0
    assert split_along_line(DOC, line, ["missing"]).split == 2


def test_piece_ids_skip_taken_ones() -> None:
    doc = parse_svg(
        contract_svg(40, 20, [("#ff0000", ["M10,5 h10 v10 h-10 z", "M0,0 h1 v1 h-1 z"])]).replace(
            b'id="p-0-1"', b'id="p-0-0.a"'
        )
    )

    assert split_along_line(doc, [(5, 10), (25, 10)]).created == ["p-0-0.b", "p-0-0.c"]


def test_holes_stay_with_their_piece_and_parts_the_line_misses_stay_whole() -> None:
    ring = VectorShape("ring", "#000000", "M0,0 H30 V30 H0 Z M10,10 V20 H20 V10 Z")
    twin = VectorShape("twin", "#000000", "M0,0 h10 v10 h-10 z M20,0 h10 v10 h-10 z")

    cut = pieces(ring, LineString([(-5, 5), (35, 5)]))
    assert cut is not None
    assert sorted(len(piece.interiors) for piece in cut) == [0, 1]
    assert pieces(twin, LineString([(-5, 20), (35, 20)])) is None  # misses both parts
    halves = pieces(twin, LineString([(5, -5), (5, 15)]))
    assert halves is not None
    assert sorted(piece.area for piece in halves) == [50, 50, 100]
    assert pieces(VectorShape("empty", "#000000", ""), LineString([(0, 0), (1, 1)])) is None
