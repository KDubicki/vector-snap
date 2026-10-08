import numpy as np
import pytest

from app.core.errors import InvalidParameters
from app.services.export_stl import (
    StackOrder,
    StlOptions,
    build_bodies,
    export_stl,
    relative_luminance,
    snap_to_layers,
    stack_layers,
)
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg, is_closed, read_binary_stl, signed_volume

FRAME = "M0,0 L20,0 L20,20 L0,20 Z M5,5 L5,15 L15,15 L15,5 Z"  # 20x20 with a 10x10 hole
DOT = "M30,0 L40,0 L40,10 L30,10 Z"


def _export(options: StlOptions, groups: list[tuple[str, list[str]]]) -> np.ndarray:
    return read_binary_stl(export_stl(parse_svg(contract_svg(40, 20, groups)), options))


def test_extrudes_a_shape_with_a_hole_into_a_closed_solid() -> None:
    triangles = _export(StlOptions(width_mm=40, base_mm=0, layer_mm=2), [("#000000", [FRAME])])

    assert is_closed(triangles)
    assert signed_volume(triangles) == pytest.approx(300 * 2)  # area x height, normals out
    assert triangles[..., 2].min() == 0
    assert triangles[..., 2].max() == 2


def test_scales_to_width_and_flips_the_y_axis() -> None:
    triangles = _export(StlOptions(width_mm=80, base_mm=0), [("#000000", [DOT])])

    # 10x10 px square at the top-right of a 40x20 px document -> 20x20 mm, y flipped
    assert triangles[..., 0].min() == pytest.approx(60)
    assert triangles[..., 0].max() == pytest.approx(80)
    assert triangles[..., 1].min() == pytest.approx(20)
    assert triangles[..., 1].max() == pytest.approx(40)


def test_layers_get_increasing_heights_on_a_base_plate() -> None:
    options = StlOptions(width_mm=40, base_mm=1, layer_mm=0.5)

    triangles = _export(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    tops = sorted({round(z, 3) for z in triangles[..., 2].ravel()})
    assert tops == [0, 1, 1.5, 2]
    # base under both shapes (300 + 100) + layer 1 (300 x 0.5) + layer 2 (100 x 1.0)
    assert signed_volume(triangles) == pytest.approx(400 + 150 + 100)


def test_flat_mode_gives_all_layers_the_same_height() -> None:
    triangles = _export(
        StlOptions(width_mm=40, base_mm=0, layer_mm=3, layered=False),
        [("#000000", [FRAME]), ("#ff0000", [DOT])],
    )

    assert triangles[..., 2].max() == 3
    assert signed_volume(triangles) == pytest.approx((300 + 100) * 3)


def test_adjacent_shapes_of_one_layer_are_merged() -> None:
    halves = ["M0,0 L10,0 L10,10 L0,10 Z", "M10,0 L20,0 L20,10 L10,10 Z"]

    triangles = _export(StlOptions(width_mm=40, base_mm=0), [("#000000", halves)])

    assert is_closed(triangles)  # no internal wall between the halves
    assert signed_volume(triangles) == pytest.approx(200)


def test_curved_shapes_are_closed_meshes() -> None:
    circle = (
        "M10,0 C15.5,0 20,4.5 20,10 C20,15.5 15.5,20 10,20 C4.5,20 0,15.5 0,10 C0,4.5 4.5,0 10,0 Z"
    )

    triangles = _export(StlOptions(width_mm=40, base_mm=0), [("#000000", [circle])])

    assert is_closed(triangles)
    assert signed_volume(triangles) == pytest.approx(np.pi * 100, rel=0.02)


def test_per_color_heights_override_the_default_rule() -> None:
    options = StlOptions(width_mm=40, base_mm=0, layer_mm=1, layer_heights={1: 4.5})

    triangles = _export(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    # layer 0 follows the rule (1 mm), layer 1 is overridden (4.5 mm)
    assert signed_volume(triangles) == pytest.approx(300 * 1 + 100 * 4.5)


def test_height_zero_leaves_a_color_and_its_base_out() -> None:
    options = StlOptions(width_mm=40, base_mm=2, layer_mm=1, layer_heights={0: 0})

    triangles = _export(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    # only the dot remains: base 2 mm + layer 2 (position 1 -> 2 mm) under/over 100 mm²
    assert signed_volume(triangles) == pytest.approx(100 * 2 + 100 * 2)
    assert triangles[..., 0].min() == pytest.approx(30)


def test_mirror_flips_the_model_horizontally() -> None:
    triangles = _export(StlOptions(width_mm=40, base_mm=0, mirror=True), [("#000000", [DOT])])

    # the dot at x 30..40 px of a 40 px wide document ends up at 0..10 mm
    assert (triangles[..., 0].min(), triangles[..., 0].max()) == pytest.approx((0, 10))
    assert is_closed(triangles)
    assert signed_volume(triangles) == pytest.approx(100)


def test_all_colors_left_out_is_an_error() -> None:
    with pytest.raises(InvalidParameters, match="Nothing to export"):
        _export(StlOptions(layer_heights={0: 0}), [("#000000", [FRAME])])


def test_bodies_are_named_and_colored_per_layer() -> None:
    document = parse_svg(contract_svg(40, 20, [("#000000", [FRAME]), ("#ff0000", [DOT])]))

    bodies = build_bodies(document, StlOptions(base_mm=1))

    assert [(body.name, body.color) for body in bodies] == [
        ("base", "#000000"),
        ("color-0", "#000000"),
        ("color-1", "#ff0000"),
    ]
    assert all(is_closed(body.triangles) for body in bodies)


THIN_LINE = "M0,15 L20,15 L20,15.2 L0,15.2 Z"  # 20 x 0.2 px


def test_min_feature_removes_details_thinner_than_the_nozzle() -> None:
    square = "M0,0 L10,0 L10,10 L0,10 Z"
    options = StlOptions(width_mm=40, base_mm=1, layer_mm=1, min_feature_mm=0.4)

    triangles = _export(options, [("#000000", [square, THIN_LINE])])

    # Only the square survives, unchanged: base (100 x 1) + layer (100 x 1).
    assert signed_volume(triangles) == pytest.approx(200)
    assert triangles[..., 1].min() == pytest.approx(10)  # y flipped: line was at y=15


def test_min_feature_keeps_everything_when_disabled() -> None:
    options = StlOptions(width_mm=40, base_mm=0, layer_mm=1)

    triangles = _export(options, [("#000000", [THIN_LINE])])

    assert signed_volume(triangles) == pytest.approx(20 * 0.2)


def test_min_feature_rejects_documents_with_only_thin_details() -> None:
    options = StlOptions(width_mm=40, base_mm=1, min_feature_mm=0.4)

    with pytest.raises(InvalidParameters, match=r"thinner than 0\.4 mm"):
        _export(options, [("#000000", [THIN_LINE])])


def test_heights_snap_to_whole_printer_layers() -> None:
    # base 1.0 -> 1.05 (7 x 0.15); layers 0.5 -> 0.45 (3 layers) and 1.0 -> 1.05 (7 layers)
    options = StlOptions(width_mm=40, base_mm=1.0, layer_mm=0.5, print_layer_mm=0.15)

    triangles = _export(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    tops = sorted({round(z, 4) for z in triangles[..., 2].ravel()})
    assert tops == [0, 1.05, 1.5, 2.1]
    assert all(round(z / 0.15, 6).is_integer() for z in tops)


def test_snapping_keeps_at_least_one_layer() -> None:
    options = StlOptions(width_mm=40, base_mm=0.05, layer_heights={0: 0.01}, print_layer_mm=0.2)

    triangles = _export(options, [("#000000", [FRAME])])

    assert sorted({round(z, 4) for z in triangles[..., 2].ravel()}) == [0, 0.2, 0.4]


@pytest.mark.parametrize(
    ("height", "layer", "expected"),
    [(1.0, 0.0, 1.0), (0.0, 0.2, 0.0), (0.3, 0.2, 0.4), (0.29, 0.2, 0.2), (1.0, 0.12, 0.96)],
)
def test_snap_to_layers(height: float, layer: float, expected: float) -> None:
    assert snap_to_layers(height, layer) == pytest.approx(expected)


def _base(options: StlOptions, groups: list[tuple[str, list[str]]]) -> np.ndarray:
    bodies = build_bodies(parse_svg(contract_svg(40, 20, groups)), options)
    assert bodies[0].name == "base"
    assert is_closed(bodies[0].triangles)
    return bodies[0].triangles


def test_rectangle_base_covers_the_design_and_the_margin() -> None:
    options = StlOptions(width_mm=40, base_mm=1, base_shape="rectangle", base_margin_mm=2)

    base = _base(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    # design spans x 0..40, y 0..20 (with a gap between frame and dot and a hole)
    assert (base[..., 0].min(), base[..., 0].max()) == pytest.approx((-2, 42))
    assert (base[..., 1].min(), base[..., 1].max()) == pytest.approx((-2, 22))
    assert signed_volume(base) == pytest.approx(44 * 24)


def test_outline_base_grows_by_the_margin() -> None:
    square = "M0,0 L10,0 L10,10 L0,10 Z"
    options = StlOptions(width_mm=40, base_mm=1, base_margin_mm=1)

    base = _base(options, [("#000000", [square])])

    # 10x10 square grown by 1 mm with round corners: 100 + 4 x 10 + pi
    assert signed_volume(base) == pytest.approx(140 + np.pi, rel=1e-3)


def test_rounded_base_has_round_corners() -> None:
    options = StlOptions(width_mm=40, base_mm=1, base_shape="rounded")

    base = _base(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    # 40x20 rectangle with corner radius 0.15 x 20 = 3 mm
    assert signed_volume(base) == pytest.approx(800 - (4 - np.pi) * 9, rel=1e-3)
    assert (base[..., 0].min(), base[..., 0].max()) == pytest.approx((0, 40))


def test_circle_base_encloses_the_whole_design() -> None:
    options = StlOptions(width_mm=40, base_mm=1, base_shape="circle", base_margin_mm=1)

    base = _base(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    # smallest circle around the 40x20 design: center (20, 10), radius sqrt(500)
    radius = float(np.hypot(base[..., 0] - 20, base[..., 1] - 10).max())
    assert radius == pytest.approx(np.sqrt(500) + 1, rel=1e-3)
    assert signed_volume(base) == pytest.approx(np.pi * radius**2, rel=1e-3)


GRAYS = [("#808080", [FRAME]), ("#ffffff", [DOT]), ("#000000", ["M22,0 L28,0 L28,6 L22,6 Z"])]


@pytest.mark.parametrize(
    ("order", "expected"),
    [
        ("document", ["color-0", "color-1", "color-2"]),
        ("light_to_dark", ["color-1", "color-0", "color-2"]),
        ("dark_to_light", ["color-2", "color-0", "color-1"]),
    ],
)
def test_stack_order_sets_which_colors_are_higher(order: StackOrder, expected: list[str]) -> None:
    document = parse_svg(contract_svg(40, 20, GRAYS))

    bodies = build_bodies(document, StlOptions(base_mm=0, layer_mm=1, stack_order=order))

    tops = {body.name: float(body.triangles[..., 2].max()) for body in bodies}
    assert [body.name for body in bodies] == expected
    assert [tops[name] for name in expected] == [1, 2, 3]


def test_brightness_order_puts_the_base_in_the_bottom_color() -> None:
    document = parse_svg(contract_svg(40, 20, GRAYS))

    bodies = build_bodies(document, StlOptions(base_mm=1, stack_order="light_to_dark"))

    assert (bodies[0].name, bodies[0].color) == ("base", "#ffffff")


def test_relative_luminance() -> None:
    assert relative_luminance("#000000") == 0
    assert relative_luminance("#ffffff") == pytest.approx(1)
    assert relative_luminance("#00ff00") > relative_luminance("#ff0000")


def test_equally_bright_colors_keep_the_document_order() -> None:
    assert stack_layers(["a", "b", "c"], ["#ff0000", "#000000", "#ff0000"], "light_to_dark") == [
        "a",
        "c",
        "b",
    ]


def test_hanging_loop_is_added_above_the_middle_of_the_base() -> None:
    options = StlOptions(width_mm=40, base_mm=1, base_shape="rectangle", loop_hole_mm=4)

    base = _base(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    # 40x20 plate; ring around a 4 mm hole centered at (20, 22): outer radius 4 mm
    assert base[..., 1].max() == pytest.approx(26, abs=1e-3)
    assert (base[..., 0].min(), base[..., 0].max()) == pytest.approx((0, 40))
    ring_area = np.pi * (16 - 4)
    overlap = 16 * np.arccos(2 / 4) - 2 * np.sqrt(16 - 4)  # circular segment inside the plate
    assert signed_volume(base) == pytest.approx(800 + ring_area - overlap, rel=1e-3)


def test_hanging_loop_hole_stays_open() -> None:
    options = StlOptions(width_mm=40, base_mm=1, loop_hole_mm=4)
    document = parse_svg(contract_svg(40, 20, [("#000000", [FRAME])]))

    triangles = np.concatenate([body.triangles for body in build_bodies(document, options)])

    # no triangle covers the hole center at (10, 22) — the frame's top-middle plus 2 mm
    inside = (np.hypot(triangles[..., 0] - 10, triangles[..., 1] - 22) < 2 - 1e-3).any(axis=1)
    assert not inside.any()


def test_hanging_loop_needs_a_base_plate() -> None:
    with pytest.raises(InvalidParameters, match="needs a base plate"):
        _export(StlOptions(base_mm=0, loop_hole_mm=4), [("#000000", [FRAME])])
