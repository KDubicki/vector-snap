import pytest

from app.core.errors import InvalidParameters
from app.services.svg_crop import crop_document
from app.services.svg_geometry import VectorDocument, flatten, parse_svg, to_polygon
from tests.vectors import contract_svg

# 100 x 80: a background over everything, a red square at (20, 10) and a curve at (60, 40).
DOC = parse_svg(
    contract_svg(
        100,
        80,
        [
            ("#ffffff", ["M0,0 H100 V80 H0 Z"]),
            ("#ff0000", ["M20,10 h10 v10 h-10 z", "M60,40 Q70,30 80,40 Z"]),
        ],
    )
)


def _bounds(document: VectorDocument, shape_id: str) -> tuple[float, ...]:
    d = next(s.d for layer in document.layers for s in layer.shapes if s.id == shape_id)
    return tuple(round(v, 3) for v in to_polygon(flatten(d)).bounds)


def test_crops_to_the_counted_shapes_with_padding() -> None:
    result = crop_document(DOC, padding=5, ignore=[0])

    # The red shapes span (20, 10) to (80, 40).
    assert (result.document.width, result.document.height) == (70, 40)
    assert (result.dx, result.dy) == (-15, -5)
    assert _bounds(result.document, "p-1-0") == (5, 5, 15, 15)
    assert "Q" not in _shape_d(result.document, "p-1-1")
    assert " C" in _shape_d(result.document, "p-1-1")  # still a curve


def test_without_ignored_colors_the_background_counts() -> None:
    result = crop_document(DOC)

    assert (result.document.width, result.document.height, result.dx, result.dy) == (
        100,
        80,
        0,
        0,
    )


def test_nothing_to_crop_to_is_rejected() -> None:
    with pytest.raises(InvalidParameters):
        crop_document(DOC, ignore=[0, 1])


def _shape_d(document: VectorDocument, shape_id: str) -> str:
    return next(s.d for layer in document.layers for s in layer.shapes if s.id == shape_id)
