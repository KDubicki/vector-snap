import pytest

from app.core.errors import InvalidParameters
from app.services.svg_geometry import VectorDocument, VectorLayer, VectorShape, parse_svg
from app.services.svg_shapes import delete_shapes, merge_shapes, shape_area
from tests.vectors import contract_svg

# White background, a red 10 x 10 square and a 2 x 2 red speck, a blue 1 x 1 speck.
DOC = parse_svg(
    contract_svg(
        40,
        20,
        [
            ("#ffffff", ["M0,0 H40 V20 H0 Z"]),
            ("#ff0000", ["M10,5 h10 v10 h-10 z", "M30,5 h2 v2 h-2 z"]),
            ("#0000ff", ["M35,15 h1 v1 h-1 z"]),
        ],
    )
)


def test_deletes_shapes_by_id_and_drops_empty_layers() -> None:
    result = delete_shapes(DOC, ["p-2-0", "p-1-1", "missing"])

    assert result.deleted == ["p-1-1", "p-2-0"]
    assert [[shape.id for shape in layer.shapes] for layer in result.document.layers] == [
        ["p-0-0"],
        ["p-1-0"],
    ]
    assert result.document.layers[0] is DOC.layers[0]  # untouched layers stay as they were


def test_deletes_shapes_smaller_than_an_area() -> None:
    assert delete_shapes(DOC, smaller_than=4).deleted == ["p-2-0"]
    assert delete_shapes(DOC, smaller_than=4.5).deleted == ["p-1-1", "p-2-0"]
    assert delete_shapes(DOC, ["p-1-0"], smaller_than=2).deleted == ["p-1-0", "p-2-0"]
    assert delete_shapes(DOC).document == DOC


def test_keeps_at_least_one_shape() -> None:
    with pytest.raises(InvalidParameters):
        delete_shapes(DOC, smaller_than=10_000)


def test_shape_area_excludes_holes() -> None:
    ring = VectorShape("ring", "#000000", "M0,0 H30 V30 H0 Z M10,10 V20 H20 V10 Z")

    assert shape_area(ring) == pytest.approx(800)
    assert shape_area(VectorShape("empty", "#000000", "")) == 0


def test_merges_shapes_into_the_largest() -> None:
    doc = parse_svg(
        contract_svg(
            40,
            20,
            [
                ("#ffffff", ["M0,0 H40 V20 H0 Z"]),
                ("#ff0000", ["M10,5 h10 v10 h-10 z", "M20,5 h5 v10 h-5 z"]),
                ("#0000ff", ["M30,5 h2 v2 h-2 z"]),
            ],
        )
    )

    result = merge_shapes(doc, ["p-2-0", "p-1-1", "p-1-0", "missing"])

    assert (result.id, result.merged) == ("p-1-0", ["p-1-1", "p-2-0"])
    assert [[shape.id for shape in layer.shapes] for layer in result.document.layers] == [
        ["p-0-0"],
        ["p-1-0"],
    ]
    merged = result.document.layers[1].shapes[0]
    assert shape_area(merged) == pytest.approx(154)
    # The touching squares fuse into one outline; the blue speck is a second subpath.
    assert merged.d.count("M") == 2
    assert merged.fill == "#ff0000"


def test_merge_needs_two_shapes_with_an_area() -> None:
    with pytest.raises(InvalidParameters):
        merge_shapes(DOC, ["p-1-0", "missing"])
    empty = VectorDocument(
        10,
        10,
        [
            VectorLayer(
                0,
                "#000000",
                [VectorShape("a", "#000000", "M0,0 Z"), VectorShape("b", "#000000", "M1,1 Z")],
            )
        ],
    )
    with pytest.raises(InvalidParameters):
        merge_shapes(empty, ["a", "b"])
