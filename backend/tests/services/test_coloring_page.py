from dataclasses import replace

import pytest
from reportlab.lib.pagesizes import A4
from shapely import box

from app.core.errors import InvalidParameters
from app.services.coloring_page import (
    MAX_NUMBER_PT,
    ColoringOptions,
    coloring_layout,
    export_coloring_page,
    number_spot,
    visible_regions,
)
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg

BACKGROUND = "M0,0 H100 V50 H0 Z"
SQUARE = "M10,10 H40 V40 H10 Z"
DOT = "M20,20 H30 V30 H20 Z"
DOCUMENT = parse_svg(
    contract_svg(100, 50, [("#ffffff", [BACKGROUND]), ("#ff0000", [SQUARE]), ("#000000", [DOT])])
)


def test_shapes_show_what_the_ones_above_leave_visible() -> None:
    (_, _, background), (_, _, square), (_, _, dot) = visible_regions(DOCUMENT)

    assert background.area == pytest.approx(5000 - 900)
    assert square.area == pytest.approx(900 - 100)
    assert dot.area == pytest.approx(100)


def test_regions_are_numbered_by_color_and_fit_the_page() -> None:
    regions, colors, page, bottom = coloring_layout(DOCUMENT, ColoringOptions())

    assert colors == ["#ffffff", "#ff0000", "#000000"]
    assert [(region.number, region.fill) for region in regions] == [
        (1, "#ffffff"),
        (2, "#ff0000"),
        (3, "#000000"),
    ]
    assert page == (A4[1], A4[0])  # landscape: the design is wider than tall
    left, low, right, high = regions[0].polygon.bounds
    margin = 12 * 72 / 25.4
    assert left == pytest.approx(margin) and right == pytest.approx(page[0] - margin)
    assert high == pytest.approx(page[1] - margin) and low == pytest.approx(bottom)


def test_left_out_colors_stay_white_and_unnumbered() -> None:
    regions, colors, _, _ = coloring_layout(DOCUMENT, ColoringOptions(exclude=frozenset({0})))

    assert colors == ["#ff0000", "#000000"]
    assert [region.number for region in regions] == [1, 2]


def test_pdf_has_numbers_and_a_legend_only_for_paint_by_numbers() -> None:
    numbered = export_coloring_page(DOCUMENT, ColoringOptions(exclude=frozenset({0})))
    plain = export_coloring_page(DOCUMENT, ColoringOptions(numbers=False, exclude=frozenset({0})))

    assert numbered.startswith(b"%PDF") and plain.startswith(b"%PDF")
    # The legend numbers are bold; reportlab only embeds the fonts a page uses.
    assert b"Helvetica-Bold" in numbered and b"Helvetica-Bold" not in plain


def test_every_color_left_out_is_an_error() -> None:
    with pytest.raises(InvalidParameters, match="Every color is excluded"):
        export_coloring_page(DOCUMENT, replace(ColoringOptions(), exclude=frozenset({0, 1, 2})))


def test_numbers_go_where_they_fit_and_skip_slivers() -> None:
    wide = number_spot(box(0, 0, 200, 100))
    sliver = number_spot(box(0, 0, 200, 3))

    assert wide is not None
    _, y, size = wide  # any point along the middle line is as far from the edges
    assert y == pytest.approx(50)
    assert size == MAX_NUMBER_PT
    assert sliver is None
