import pytest

from app.core.errors import InvalidParameters
from app.services.svg_geometry import (
    VectorDocument,
    VectorShape,
    flatten,
    parse_svg,
    to_polygon,
)
from app.services.svg_transform import transform_matrix, transform_path, transform_shapes
from tests.vectors import contract_svg

# A white background and a red 10 x 10 square at (10, 5), the second red shape a curve.
DOC = parse_svg(
    contract_svg(
        40,
        20,
        [
            ("#ffffff", ["M0,0 H40 V20 H0 Z"]),
            ("#ff0000", ["M10,5 h10 v10 h-10 z", "M30,5 Q35,0 40,5 Z"]),
        ],
    )
)


def _bounds(shape: VectorShape) -> tuple[float, ...]:
    return tuple(round(v, 3) for v in to_polygon(flatten(shape.d)).bounds)


def _shape(document: VectorDocument, shape_id: str) -> VectorShape:
    return next(
        shape for layer in document.layers for shape in layer.shapes if shape.id == shape_id
    )


def test_rotates_clockwise_around_a_center_like_the_editor() -> None:
    # The editor's 90° rotation around (5, 5): [0, 1, -1, 0, cx + cy, cy - cx].
    assert transform_matrix((5, 5), rotate=90) == pytest.approx((0, 1, -1, 0, 10, 0))
    assert transform_path("M10,0 L10,2 Z", transform_matrix((0, 0), rotate=90)) == (
        "M0,10 L-2,10 Z"
    )


def test_moves_scales_and_flips_the_given_shapes_around_their_center() -> None:
    moved = transform_shapes(DOC, ["p-1-0"], dx=5, dy=-2)
    assert moved.transformed == ["p-1-0"]
    assert _bounds(_shape(moved.document, "p-1-0")) == (15, 3, 25, 13)
    assert moved.document.layers[0] is DOC.layers[0]  # untouched layers stay as they were

    bigger = transform_shapes(DOC, ["p-1-0", "missing"], scale=2)
    assert _bounds(_shape(bigger.document, "p-1-0")) == (5, 0, 25, 20)

    flipped = transform_shapes(DOC, ["p-1-0"], flip="x", rotate=180)
    assert _bounds(_shape(flipped.document, "p-1-0")) == (10, 5, 20, 15)


def test_curves_stay_curves() -> None:
    result = transform_shapes(DOC, ["p-1-1"], dx=-30)

    d = _shape(result.document, "p-1-1").d
    assert d.startswith("M0,5 C") and d.endswith("Z")
    assert _bounds(_shape(result.document, "p-1-1")) == pytest.approx((0, 2.5, 10, 5))


def test_without_ids_every_shape_turns_around_the_design_center() -> None:
    result = transform_shapes(DOC, rotate=180)

    assert result.transformed == ["p-0-0", "p-1-0", "p-1-1"]
    assert _bounds(_shape(result.document, "p-0-0")) == (0, 0, 40, 20)
    assert _bounds(_shape(result.document, "p-1-0")) == (20, 5, 30, 15)


def test_unknown_or_empty_shapes_are_rejected() -> None:
    with pytest.raises(InvalidParameters):
        transform_shapes(DOC, ["missing"], dx=1)
    empty = parse_svg(contract_svg(10, 10, [("#000000", ["M0,0 Z"])]))
    with pytest.raises(InvalidParameters):
        transform_shapes(empty, dx=1)
