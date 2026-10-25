import pytest

from app.services.model_options import StlOptions
from app.services.print_check import PrintCheck, check_print
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg

SQUARE = "M2 2 H12 V12 H2 Z"
HAIRLINE = "M20 2 H20.3 V12 H20 Z"  # 0.3 x 10 px
AT_40_MM = StlOptions(width_mm=40)  # 1 px = 1 mm


def _check(
    groups: list[tuple[str, list[str]]],
    nozzle_mm: float = 0.4,
    options: StlOptions = AT_40_MM,
) -> PrintCheck:
    return check_print(parse_svg(contract_svg(40, 20, groups)), options, nozzle_mm)


def test_reports_shapes_thinner_than_the_nozzle() -> None:
    check = _check([("#000000", [SQUARE, HAIRLINE])])

    assert [shape.shape_id for shape in check.shapes] == ["p-0-1"]
    hairline = check.shapes[0]
    assert hairline.vanishes
    assert hairline.color == "#000000"
    assert hairline.area_mm2 == pytest.approx(3, abs=0.01)
    assert hairline.thin_mm2 == pytest.approx(3, abs=0.01)
    assert check.thin_mm2 == pytest.approx(3, abs=0.05)


def test_a_finer_nozzle_or_a_wider_model_prints_them() -> None:
    assert _check([("#000000", [HAIRLINE])], nozzle_mm=0.25).shapes == []
    assert _check([("#000000", [HAIRLINE])], options=StlOptions(width_mm=80)).shapes == []


def test_counts_only_what_shapes_drawn_above_leave_uncovered() -> None:
    # The red square leaves a 0.2 mm strip of the black one showing on the right.
    check = _check([("#000000", ["M2 2 H12.2 V12 H2 Z"]), ("#ff0000", [SQUARE])])

    assert [shape.shape_id for shape in check.shapes] == ["p-0-0"]
    assert check.shapes[0].area_mm2 == pytest.approx(2, abs=0.01)


def test_leaves_out_colors_without_height() -> None:
    check = _check(
        [("#000000", [SQUARE]), ("#ff0000", [HAIRLINE])],
        options=StlOptions(width_mm=40, layer_heights={1: 0}),
    )

    assert check.shapes == []
