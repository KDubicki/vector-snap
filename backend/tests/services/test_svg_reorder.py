import pytest

from app.core.errors import InvalidParameters
from app.services.svg_geometry import VectorDocument, parse_svg
from app.services.svg_reorder import reorder_layers
from tests.vectors import contract_svg

# Bottom to top: a small black square, a white background, a mid gray square.
DOC = parse_svg(
    contract_svg(
        40,
        20,
        [
            ("#000000", ["M0,0 h5 v5 h-5 z"]),
            ("#ffffff", ["M0,0 H40 V20 H0 Z"]),
            ("#808080", ["M10,5 h10 v10 h-10 z"]),
        ],
    )
)


def _order(document: VectorDocument) -> list[int]:
    return [layer.palette_index for layer in document.layers]


def test_puts_layers_in_the_given_order() -> None:
    result = reorder_layers(DOC, [1, 0, 2])

    assert _order(result) == [1, 0, 2]
    assert result.layers[0] is DOC.layers[1]


@pytest.mark.parametrize("order", [[0, 1], [0, 1, 1], [0, 1, 2, 3]])
def test_the_order_lists_every_layer_once(order: list[int]) -> None:
    with pytest.raises(InvalidParameters):
        reorder_layers(DOC, order)


def test_sorts_by_brightness_or_area() -> None:
    assert _order(reorder_layers(DOC, sort="light_to_dark")) == [1, 2, 0]
    assert _order(reorder_layers(DOC, sort="dark_to_light")) == [0, 2, 1]
    assert _order(reorder_layers(DOC, sort="largest_first")) == [1, 2, 0]
