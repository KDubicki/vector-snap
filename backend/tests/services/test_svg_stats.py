import pytest

from app.services.svg_geometry import parse_svg
from app.services.svg_stats import LayerStats, svg_stats
from tests.vectors import contract_svg

# 40 x 20: a white background, two red squares (one blue of its own) and a red speck.
DOC = parse_svg(
    contract_svg(
        40,
        20,
        [
            ("#ffffff", ["M0,0 H40 V20 H0 Z"]),
            ("#ff0000", ["M10,5 h10 v10 h-10 z", "M15,5 h10 v10 h-10 z", "M30,5 h2 v2 h-2 z"]),
        ],
    ).replace(b'id="p-1-1"', b'id="p-1-1" fill="#0000ff"')
)


def test_counts_shapes_area_and_specks_per_layer() -> None:
    stats = svg_stats(DOC)

    assert (stats.width, stats.height, stats.shapes, stats.specks) == (40, 20, 4, 1)
    assert stats.layers == [
        LayerStats(0, "#ffffff", 1, 0, 800.0, 1.0, 0),
        # The two squares overlap by 5 x 10: their area counts once.
        LayerStats(1, "#ff0000", 3, 1, 154.0, 0.1925, 1),
    ]


def test_speck_area_is_a_parameter() -> None:
    assert svg_stats(DOC, speck_area=4.5).specks == 1
    assert svg_stats(DOC, speck_area=4).specks == 0
    assert svg_stats(DOC, speck_area=101).layers[1].specks == 3


def test_share_never_exceeds_the_document() -> None:
    doc = parse_svg(contract_svg(10, 10, [("#000000", ["M-5,-5 H20 V20 H-5 Z"])]))

    assert svg_stats(doc).layers[0].share == pytest.approx(1.0)
