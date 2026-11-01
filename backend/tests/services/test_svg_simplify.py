import pytest

from app.services.svg_geometry import VectorDocument, flatten, parse_svg, to_polygon
from app.services.svg_simplify import outline_points, simplify_shapes
from tests.vectors import contract_svg

# A square with a wobbly top edge (points 0.2 px off the line) and a hole; a triangle.
WOBBLY = "M0,0 L5,0.2 L10,0 L15,0.2 L20,0 L20,20 L0,20 Z M5,5 L15,5 L15,15 L5,15 Z"
DOC = parse_svg(contract_svg(40, 20, [("#ff0000", [WOBBLY, "M25,0 L35,0 L30,10 Z"])]))


def _shape_d(document: VectorDocument, shape_id: str) -> str:
    return next(
        shape.d for layer in document.layers for shape in layer.shapes if shape.id == shape_id
    )


def test_drops_points_within_the_tolerance_and_keeps_holes() -> None:
    result = simplify_shapes(DOC, 0.5)

    assert result.simplified == ["p-0-0"]
    assert (result.points_before, result.points_after) == (7 + 4 + 3, 4 + 4 + 3)
    outline = to_polygon(flatten(_shape_d(result.document, "p-0-0")))
    assert outline_points(outline) == 8
    assert outline.area == pytest.approx(300)  # 20 x 20 minus the 10 x 10 hole
    assert _shape_d(result.document, "p-0-1") == _shape_d(DOC, "p-0-1")


def test_a_small_tolerance_or_other_ids_change_nothing() -> None:
    assert simplify_shapes(DOC, 0.1).simplified == []
    only = simplify_shapes(DOC, 0.5, ["p-0-1"])
    assert only.simplified == []
    assert (only.points_before, only.points_after) == (3, 3)


def test_slivers_keep_an_area_rather_than_vanish() -> None:
    doc = parse_svg(contract_svg(10, 10, [("#000000", ["M0,0 L4,0.1 L8,0 L4,0.2 Z"])]))

    result = simplify_shapes(doc, 5)
    outline = to_polygon(flatten(_shape_d(result.document, "p-0-0")))
    assert outline.area > 0
    assert result.points_after >= 3
