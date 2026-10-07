from app.services.export_stl import StlOptions
from app.services.filament_plan import (
    FilamentConflict,
    FilamentPlan,
    FilamentStep,
    filament_plan,
)
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg

BACK = "M0,0 L40,0 L40,20 L0,20 Z"
LEFT = "M0,0 L10,0 L10,10 L0,10 Z"
RIGHT = "M30,0 L40,0 L40,10 L30,10 Z"
GROUPS = [("#ffffff", [BACK]), ("#ff0000", [LEFT]), ("#0000ff", [RIGHT])]


def _plan(options: StlOptions, groups: list[tuple[str, list[str]]] = GROUPS) -> FilamentPlan:
    return filament_plan(parse_svg(contract_svg(40, 20, groups)), options)


def test_layered_relief_changes_filament_where_each_color_ends() -> None:
    plan = _plan(StlOptions(width_mm=40, base_mm=1, layer_mm=0.5, print_layer_mm=0.25))

    # base (white, the bottom color) 0-1, white 1-1.5, red 1.5-2, blue 2-2.5
    assert plan.steps == [
        FilamentStep(z_mm=0, color="#ffffff", layer=1),
        FilamentStep(z_mm=1.5, color="#ff0000", layer=7),
        FilamentStep(z_mm=2.0, color="#0000ff", layer=9),
    ]
    assert plan.conflicts == []
    assert plan.height_mm == 2.5


def test_layer_numbers_need_the_printer_layer_height() -> None:
    plan = _plan(StlOptions(width_mm=40, base_mm=1, layer_mm=0.5))

    assert [step.layer for step in plan.steps] == [None, None, None]


def test_colors_ending_at_the_same_height_are_conflicts() -> None:
    plan = _plan(StlOptions(width_mm=40, base_mm=1, layer_mm=1, layer_heights={1: 2, 2: 2}))

    assert plan.conflicts == [FilamentConflict(z_mm=3.0, colors=["#ff0000", "#0000ff"])]
    assert [step.color for step in plan.steps] == ["#ffffff", "#ff0000"]


def test_same_colored_groups_do_not_need_a_change() -> None:
    groups = [("#ffffff", [BACK]), ("#ffffff", [LEFT]), ("#000000", [RIGHT])]

    plan = _plan(StlOptions(width_mm=40, base_mm=1, layer_mm=0.5), groups)

    assert [(step.z_mm, step.color) for step in plan.steps] == [(0, "#ffffff"), (2.0, "#000000")]


def test_without_a_base_the_lowest_color_starts() -> None:
    plan = _plan(StlOptions(width_mm=40, base_mm=0, layer_mm=1, layer_heights={0: 0}))

    assert plan.steps[0] == FilamentStep(z_mm=0, color="#ff0000", layer=None)
    # red keeps its position in the stack (2 mm), blue goes on to 3 mm
    assert plan.steps[1] == FilamentStep(z_mm=2.0, color="#0000ff", layer=None)
