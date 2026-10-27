import math
from dataclasses import replace

import pytest
from lxml import etree

from app.core.errors import InvalidParameters
from app.services.sticker import (
    CUT_CONTOUR,
    StickerOptions,
    export_sticker,
    sticker_layout,
)
from app.services.svg_geometry import parse_svg
from tests.vectors import SVG_NS, contract_svg

BACKGROUND = "M0,0 H80 V40 H0 Z"
FRAME = "M10,10 H30 V30 H10 Z M15,15 V25 H25 V15 Z"  # a square with a hole
SQUARE = "M50,10 H70 V30 H50 Z"
DOCUMENT = parse_svg(
    contract_svg(80, 40, [("#ffffff", [BACKGROUND]), ("#ff0000", [FRAME]), ("#0000ff", [SQUARE])])
)
OPTIONS = StickerOptions(width_mm=80, border_mm=2, smooth_mm=0, exclude=frozenset({0}))


def _rounded_square(size: float, border: float) -> float:
    return size**2 + 4 * size * border + math.pi * border**2


def test_the_outline_grows_around_each_piece_with_holes_filled() -> None:
    sticker = sticker_layout(DOCUMENT, OPTIONS)

    pieces = list(getattr(sticker.outline, "geoms", [sticker.outline]))
    assert len(pieces) == 2
    assert all(not piece.interiors for piece in pieces)
    assert sticker.outline.area == pytest.approx(2 * _rounded_square(20, 2), rel=0.01)
    assert [layer.fill for layer in sticker.document.layers] == ["#ff0000", "#0000ff"]


def test_svg_has_background_design_and_cut_line_in_mm() -> None:
    root = etree.fromstring(export_sticker(DOCUMENT, OPTIONS))

    assert root.get("width") == "64mm" and root.get("height") == "24mm"
    background, design, cut = list(root)
    assert background.get("id") == "background" and background.get("fill") == "#ffffff"
    assert design.get("transform") == "translate(-8 -8) scale(1)"
    assert [path.get("fill") for path in design] == ["#ff0000", "#0000ff"]
    assert cut.get("id") == CUT_CONTOUR and cut.get("fill") == "none"
    assert cut.get("d") == background.get("d")
    assert cut.get("d", "").count("Z") == 2
    assert root.tag == f"{{{SVG_NS}}}svg"


def test_pdf_cuts_along_a_cutcontour_spot_color() -> None:
    pdf = export_sticker(DOCUMENT, replace(OPTIONS, sticker_format="pdf", margin_mm=5))

    assert pdf.startswith(b"%PDF")
    assert b"/Separation /CutContour" in pdf
    # 64 x 24 mm plus 5 mm on every side, in points
    assert b"/MediaBox [ 0 0 209.7638 96.37795 ]" in pdf


def test_without_border_the_cut_follows_the_design() -> None:
    sticker = sticker_layout(DOCUMENT, replace(OPTIONS, border_mm=0))

    assert sticker.outline.area == pytest.approx(2 * 400)


@pytest.mark.parametrize(
    ("options", "message"),
    [
        (replace(OPTIONS, exclude=frozenset({0, 1, 2})), "Every color is excluded."),
        (replace(OPTIONS, width_mm=1), "no outline large enough"),
    ],
)
def test_nothing_to_cut_is_an_error(options: StickerOptions, message: str) -> None:
    with pytest.raises(InvalidParameters, match=message):
        export_sticker(DOCUMENT, options)
