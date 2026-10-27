import io
import zipfile
from dataclasses import replace

import pytest
from lxml import etree
from shapely import Polygon

from app.core.errors import InvalidParameters
from app.services.stencil import (
    BridgeDirection,
    StencilOptions,
    color_stencils,
    export_stencil,
    stencil_layout,
)
from app.services.svg_geometry import VectorDocument, parse_svg, polygons
from tests.vectors import contract_svg

LETTER_O = "M10,10 H40 V40 H10 Z M18,18 V32 H32 V18 Z"  # 30 mm square, 14 mm island
# Two nested rings: the inner square island and the ring between the cuts.
RINGS = "M50,5 H95 V50 H50 Z M55,10 V45 H90 V10 Z M60,15 H85 V40 H60 Z M65,20 V35 H80 V20 Z"
BACKGROUND = "M0,0 H100 V60 H0 Z"
OPTIONS = StencilOptions(width_mm=100, margin_mm=10, bridge_mm=1.5, exclude=frozenset({0}))


def _document(*paths: str) -> VectorDocument:
    return parse_svg(contract_svg(100, 60, [("#ffffff", [BACKGROUND]), ("#000000", list(paths))]))


def _material(options: StencilOptions, *paths: str) -> list[Polygon]:
    stencil = stencil_layout(_document(*paths), options)
    return polygons(stencil.sheet - stencil.cuts)


def test_without_islands_there_are_no_bridges() -> None:
    stencil = stencil_layout(_document("M10,10 H40 V40 H10 Z"), OPTIONS)

    assert stencil.bridges == 0
    assert stencil.cuts.area == pytest.approx(900)
    assert stencil.sheet.bounds == (0, 0, 50, 50)


def test_the_middle_of_an_o_is_held_on_both_sides() -> None:
    stencil = stencil_layout(_document(LETTER_O), OPTIONS)

    assert stencil.bridges == 2
    assert stencil.cuts.area == pytest.approx(900 - 196 - 2 * 8 * 1.5)
    assert len(polygons(stencil.sheet - stencil.cuts)) == 1


@pytest.mark.parametrize("bridges", ["horizontal", "vertical", "both"])
def test_nested_islands_all_stay_attached(bridges: BridgeDirection) -> None:
    options = replace(OPTIONS, bridges=bridges)

    assert len(_material(options, LETTER_O, RINGS)) == 1


def test_both_bridges_every_island_both_ways() -> None:
    one = stencil_layout(_document(LETTER_O), OPTIONS)
    both = stencil_layout(_document(LETTER_O), replace(OPTIONS, bridges="both"))

    assert (one.bridges, both.bridges) == (2, 4)


def test_svg_and_dxf_hold_the_sheet_and_the_cuts() -> None:
    svg, bridges = export_stencil(_document(LETTER_O), OPTIONS)
    assert bridges == 2
    root = etree.fromstring(svg)
    sheet, cuts = list(root)
    assert (root.get("width"), root.get("height")) == ("50mm", "50mm")
    assert sheet.get("id") == "sheet" and cuts.get("fill-rule") == "evenodd"
    assert cuts.get("d", "").count("Z") == 2  # bridged: two halves of the O

    dxf, _ = export_stencil(_document(LETTER_O), replace(OPTIONS, stencil_format="dxf"))
    text = dxf.decode()
    assert text.count("LWPOLYLINE") == 3 and "\ncuts\n" in text and "\nsheet\n" in text


@pytest.mark.parametrize(
    ("options", "message"),
    [
        (replace(OPTIONS, exclude=frozenset({0, 1})), "Every color is excluded."),
        (replace(OPTIONS, width_mm=1), "nothing large enough"),
    ],
)
def test_nothing_to_cut_is_an_error(options: StencilOptions, message: str) -> None:
    with pytest.raises(InvalidParameters, match=message):
        export_stencil(_document(LETTER_O), options)


def test_one_stencil_per_color_on_the_same_sheet() -> None:
    document = parse_svg(
        contract_svg(
            100,
            60,
            [
                ("#ffffff", [BACKGROUND]),
                ("#ff0000", [LETTER_O]),
                ("#0000ff", ["M50,20 H90 V40 H50 Z"]),
            ],
        )
    )
    stencils = color_stencils(document, OPTIONS)

    assert [fill for fill, _ in stencils] == ["#ff0000", "#0000ff"]
    (_, red), (_, blue) = stencils
    assert red.sheet.bounds == blue.sheet.bounds == (0, 0, 100, 50)
    assert (red.bridges, blue.bridges) == (2, 0)
    assert blue.cuts.bounds == (50, 20, 90, 40)  # lines up with the red one

    data, bridges = export_stencil(document, replace(OPTIONS, per_color=True))
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.namelist() == ["stencil-01-ff0000.svg", "stencil-02-0000ff.svg"]
    assert bridges == 2
