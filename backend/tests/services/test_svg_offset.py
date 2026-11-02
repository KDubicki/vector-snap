import pytest

from app.core.errors import InvalidParameters
from app.services.svg_geometry import VectorDocument, flatten, parse_svg, to_polygon
from app.services.svg_offset import offset_shapes
from tests.vectors import contract_svg

# A 20 x 20 square with a 10 x 10 hole, and a 2 x 2 speck.
FRAME = "M0,0 H20 V20 H0 Z M5,5 H15 V15 H5 Z"
DOC = parse_svg(contract_svg(40, 20, [("#ff0000", [FRAME, "M30,5 h2 v2 h-2 z"])]))


def _area(document: VectorDocument, shape_id: str) -> float:
    d = next(s.d for layer in document.layers for s in layer.shapes if s.id == shape_id)
    return float(to_polygon(flatten(d)).area)


def test_grows_outlines_out_and_holes_in() -> None:
    sharp = offset_shapes(DOC, 1, corners="sharp")

    assert sharp.offset == ["p-0-0", "p-0-1"]
    assert sharp.removed == []
    # 22 x 22 outside, 8 x 8 hole.
    assert _area(sharp.document, "p-0-0") == pytest.approx(22 * 22 - 8 * 8)
    # Round corners add a quarter circle per corner instead of a square.
    rounded = offset_shapes(DOC, 1, ["p-0-1"])
    assert _area(rounded.document, "p-0-1") == pytest.approx(16 - 4 + 3.14, abs=0.05)
    assert _area(rounded.document, "p-0-0") == pytest.approx(300)  # not asked for


def test_shrinking_removes_shapes_that_vanish() -> None:
    result = offset_shapes(DOC, -1.5, corners="sharp")

    assert result.removed == ["p-0-1"]
    assert _area(result.document, "p-0-0") == pytest.approx(17 * 17 - 13 * 13)


def test_shrinking_everything_away_is_rejected() -> None:
    with pytest.raises(InvalidParameters):
        offset_shapes(DOC, -20)
