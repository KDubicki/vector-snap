import pytest

from app.services.svg_geometry import VectorDocument, flatten, parse_svg, to_polygon
from app.services.svg_holes import fill_holes
from tests.vectors import contract_svg

# A 30 x 20 red frame with three holes: a 2 x 2 empty pin hole, a 4 x 4 hole a blue dot
# fills, and a 10 x 10 empty window holding a red island.
RED = (
    "M0,0 H30 V20 H0 Z M2,2 h2 v2 h-2 z M8,2 h4 v4 h-4 z "
    "M15,5 h10 v10 h-10 z M18,8 C20,7 22,9 21,11 Z"
)
DOC = parse_svg(contract_svg(30, 20, [("#ff0000", [RED]), ("#0000ff", ["M8,2 h4 v4 h-4 z"])]))


def _d(document: VectorDocument, shape_id: str) -> str:
    return next(s.d for layer in document.layers for s in layer.shapes if s.id == shape_id)


def _area(document: VectorDocument, shape_id: str) -> float:
    return float(to_polygon(flatten(_d(document, shape_id))).area)


def test_fills_small_empty_holes_and_keeps_filled_ones_and_curves() -> None:
    before = _area(DOC, "p-0-0")
    result = fill_holes(DOC, 10)

    assert (result.filled, result.shapes) == (1, ["p-0-0"])
    assert _area(result.document, "p-0-0") == pytest.approx(before + 4)
    assert " C" in _d(result.document, "p-0-0")  # the island's curve is kept
    assert result.document.layers[1] == DOC.layers[1]


def test_a_filled_window_takes_its_island_with_it() -> None:
    result = fill_holes(DOC, 150)

    # The pin hole and the window (with its island); the blue-filled hole stays.
    assert result.filled == 2
    assert _area(result.document, "p-0-0") == pytest.approx(600 - 16)


def test_only_the_given_shapes_and_nothing_below_the_size() -> None:
    assert fill_holes(DOC, 10, ["p-1-0"]).filled == 0
    assert fill_holes(DOC, 3).document == DOC
