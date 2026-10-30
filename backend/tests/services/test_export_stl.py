import io
import zipfile
from dataclasses import replace

import numpy as np
import pytest

from app.core.errors import InvalidParameters
from app.services.export_stl import (
    build_bodies,
    copy_grid,
    export_stl,
    export_stl_parts,
    model_size,
)
from app.services.mixed_colors import stack_slabs
from app.services.model_options import (
    Body,
    ColorStack,
    Relief,
    StackOrder,
    StlOptions,
    snap_to_layers,
)
from app.services.model_parts import relative_luminance, stack_layers
from app.services.svg_geometry import VectorDocument, parse_svg
from tests.vectors import contract_svg, is_balanced, is_closed, read_binary_stl, signed_volume

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


def test_simplify_reduces_triangles_within_the_tolerance() -> None:
    circle = (
        "M10,0 C15.5,0 20,4.5 20,10 C20,15.5 15.5,20 10,20 C4.5,20 0,15.5 0,10 C0,4.5 4.5,0 10,0 Z"
    )
    exact = _export(StlOptions(width_mm=40, base_mm=0), [("#000000", [circle])])

    simplified = _export(
        StlOptions(width_mm=40, base_mm=0, simplify_mm=0.3), [("#000000", [circle])]
    )

    assert is_closed(simplified)
    assert len(simplified) < len(exact) / 2
    radii = np.hypot(simplified[..., 0] - 10, simplified[..., 1] - 10)
    assert radii.max() == pytest.approx(10, abs=0.1)  # kept points lie on the curve
    assert signed_volume(simplified) == pytest.approx(signed_volume(exact), rel=0.05)


def test_color_gap_keeps_neighbouring_colors_apart() -> None:
    left, right = "M0,0 L10,0 L10,10 L0,10 Z", "M10,0 L20,0 L20,10 L10,10 Z"
    document = parse_svg(contract_svg(40, 20, [("#000000", [left]), ("#ff0000", [right])]))

    bodies = build_bodies(document, StlOptions(width_mm=40, base_mm=1, color_gap_mm=0.4))

    base, black, red = (body.triangles for body in bodies)
    assert signed_volume(base) == pytest.approx(200)  # the base plate keeps its outline
    assert black[..., 0].max() == pytest.approx(9.8)
    assert red[..., 0].min() == pytest.approx(10.2)
    assert all(is_closed(t) for t in (black, red))
    assert signed_volume(black) == pytest.approx(9.6 * 9.6 * 1)  # sharp corners


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
    options = StlOptions(width_mm=40, base_mm=1, base_shape="rounded", base_margin_mm=2)

    base = _base(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    # 44x24 plate with corner radius 0.15 x 20 + 2 = 5 mm, which still covers the
    # square corner of FRAME at the design's bounding box corner
    assert signed_volume(base) == pytest.approx(44 * 24 - (4 - np.pi) * 25, rel=1e-3)
    assert (base[..., 0].min(), base[..., 0].max()) == pytest.approx((-2, 42))


def test_rounded_base_without_margin_keeps_square_design_corners() -> None:
    options = StlOptions(width_mm=40, base_mm=1, base_shape="rounded")

    base = _base(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    # FRAME fills the bounding box corner: round corners would cut it off
    assert signed_volume(base) == pytest.approx(800, rel=1e-3)


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


def _bodies(options: StlOptions, groups: list[tuple[str, list[str]]]) -> dict[str, Body]:
    document = parse_svg(contract_svg(40, 20, groups))
    return {body.name: body for body in build_bodies(document, options)}


def test_rim_frames_the_base_plate_as_high_as_the_tallest_color() -> None:
    options = StlOptions(
        width_mm=40,
        base_mm=1,
        layer_mm=0.6,
        layered=False,
        base_shape="rectangle",
        base_margin_mm=3,
        rim_mm=2,
    )

    bodies = _bodies(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    rim = bodies["rim"].triangles
    assert is_closed(rim)
    assert bodies["rim"].color == "#000000"  # the base plate's color
    assert (rim[..., 2].min(), rim[..., 2].max()) == pytest.approx((1, 1.6))
    # 46 x 26 plate minus its 42 x 22 inside, 0.6 mm high; the design stays clear of it
    assert signed_volume(rim) == pytest.approx((46 * 26 - 42 * 22) * 0.6)
    assert signed_volume(bodies["color-0"].triangles) == pytest.approx(300 * 0.6)


def test_rim_height_can_be_set_and_cuts_away_the_colors_under_it() -> None:
    options = StlOptions(width_mm=40, base_mm=1, layer_mm=0.6, rim_mm=1, rim_height_mm=2)

    bodies = _bodies(options, [("#000000", [FRAME])])

    assert bodies["rim"].triangles[..., 2].max() == pytest.approx(3)
    # outline plate = the 20 x 20 frame: the rim takes its outer 1 mm band, not the hole's
    assert signed_volume(bodies["rim"].triangles) == pytest.approx((400 - 324) * 2)
    remaining = 300 - (400 - 324)
    assert signed_volume(bodies["color-0"].triangles) == pytest.approx(remaining * 0.6)


def test_rim_uses_the_base_filament_with_mixed_colors() -> None:
    options = StlOptions(
        width_mm=40,
        base_mm=1,
        layer_mm=1,
        rim_mm=1,
        filaments=("#ffffff", "#ff0000"),
        color_stacks={0: ColorStack(base=1)},
    )

    assert _bodies(options, [("#000000", [FRAME])])["rim"].color == "#ffffff"


LEFT = "M0,0 L20,0 L20,20 L0,20 Z"
RIGHT = "M20,0 L40,0 L40,20 L20,20 Z"


def test_outlines_trace_every_color_in_their_own_filament() -> None:
    options = StlOptions(width_mm=40, base_mm=1, layer_mm=0.6, layered=False, outline_mm=1)

    bodies = _bodies(options, [("#ffffff", [LEFT]), ("#ff0000", [RIGHT])])

    outline = bodies["outline"]
    assert is_closed(outline.triangles)
    assert outline.color == "#000000"
    assert (outline.triangles[..., 2].min(), outline.triangles[..., 2].max()) == pytest.approx(
        (1, 1.6)
    )
    # A 1 mm band inside the 40 x 20 design's edge and one centered on the shared edge.
    area = (40 * 20 - 38 * 18) + 18
    assert signed_volume(outline.triangles) == pytest.approx(area * 0.6, rel=1e-3)
    colors = signed_volume(bodies["color-0"].triangles) + signed_volume(bodies["color-1"].triangles)
    assert colors == pytest.approx((800 - area) * 0.6, rel=1e-3)


def test_outlines_can_stand_above_the_colors() -> None:
    options = StlOptions(
        width_mm=40,
        base_mm=1,
        layer_mm=0.6,
        outline_mm=0.8,
        outline_color="#123456",
        outline_height_mm=2,
    )

    outline = _bodies(options, [("#ffffff", [LEFT])])["outline"]

    assert outline.color == "#123456"
    assert outline.triangles[..., 2].max() == pytest.approx(3)


@pytest.mark.parametrize("relief", ["inlay", "engrave"])
def test_outlines_need_raised_colors(relief: Relief) -> None:
    options = StlOptions(width_mm=40, base_mm=2, layer_mm=0.6, outline_mm=1, relief=relief)

    with pytest.raises(InvalidParameters, match="Outlines stand on the base plate"):
        _bodies(options, [("#ffffff", [LEFT])])


def test_rim_needs_a_base_plate() -> None:
    with pytest.raises(InvalidParameters, match="rim needs a base plate"):
        _export(StlOptions(base_mm=0, rim_mm=2), [("#000000", [FRAME])])


def test_magnet_pocket_is_recessed_into_the_underside_of_the_base() -> None:
    square = "M0,0 L20,0 L20,20 L0,20 Z"
    options = StlOptions(width_mm=40, base_mm=3, magnet_mm=10, magnet_depth_mm=2)

    base = _base(options, [("#000000", [square])])

    pocket = np.pi * 25 * np.cos(np.pi / 128) * np.sinc(1 / 64)  # area of the 128-gon
    assert signed_volume(base) == pytest.approx(400 * 3 - pocket * 2, rel=1e-4)
    # the pocket is centered in the square (y flipped: 10..30 -> center (10, 10))
    floor = base[(base[..., 2] == 2).all(axis=1)]
    assert np.hypot(floor[..., 0] - 10, floor[..., 1] - 10).max() == pytest.approx(5, abs=1e-6)


def test_several_magnet_pockets_are_recessed_into_the_base() -> None:
    plate = "M0,0 L40,0 L40,20 L0,20 Z"
    options = StlOptions(width_mm=40, base_mm=3, magnet_mm=8, magnet_depth_mm=2, magnet_count=2)

    base = _base(options, [("#000000", [plate])])

    pocket = np.pi * 16 * np.cos(np.pi / 128) * np.sinc(1 / 64)  # area of the 128-gon
    assert signed_volume(base) == pytest.approx(800 * 3 - 2 * pocket * 2, rel=1e-4)
    # Pocket ceilings at 2 mm, centered in the two halves (y flipped: center y = 10).
    ceiling = base[(base[..., 2] == 2).all(axis=1)]
    to_left = np.hypot(ceiling[..., 0] - 10, ceiling[..., 1] - 10)
    to_right = np.hypot(ceiling[..., 0] - 30, ceiling[..., 1] - 10)
    assert np.minimum(to_left, to_right).max() == pytest.approx(4, abs=1e-6)
    assert (to_left < 4.01).any() and (to_right < 4.01).any()


SQUARE_20 = "M0,0 L20,0 L20,20 L0,20 Z"


def test_elephant_foot_insets_the_first_layer_of_the_base() -> None:
    options = StlOptions(width_mm=40, base_mm=1, elephant_foot_mm=0.3)

    base = _base(options, [("#000000", [SQUARE_20])])

    assert signed_volume(base) == pytest.approx(400 * 0.8 + 19.4**2 * 0.2)
    bottom = base[(base[..., 2] == 0).all(axis=1)]
    assert (bottom[..., 0].min(), bottom[..., 0].max()) == pytest.approx((0.3, 19.7))
    assert base[..., 0].min() == pytest.approx(0)  # above the first layer: full size


def test_elephant_foot_follows_the_printer_layer_and_keeps_the_magnet_pocket() -> None:
    options = StlOptions(
        width_mm=40,
        base_mm=3,
        print_layer_mm=0.3,
        magnet_mm=10,
        magnet_depth_mm=2,
        elephant_foot_mm=0.5,
    )

    base = _base(options, [("#000000", [SQUARE_20])])

    pocket = np.pi * 25 * np.cos(np.pi / 128) * np.sinc(1 / 64)
    expected = 400 * 2.7 + 19**2 * 0.3 - pocket * 2
    assert signed_volume(base) == pytest.approx(expected, rel=1e-4)


def test_elephant_foot_on_a_one_layer_base_insets_all_of_it() -> None:
    options = StlOptions(width_mm=40, base_mm=0.2, elephant_foot_mm=0.5)

    base = _base(options, [("#000000", [SQUARE_20])])

    assert signed_volume(base) == pytest.approx(19**2 * 0.2)


def test_elephant_foot_leaves_parts_too_thin_for_it() -> None:
    options = StlOptions(width_mm=40, base_mm=1, elephant_foot_mm=0.5)

    base = _base(options, [("#000000", ["M0,0 L20,0 L20,0.8 L0,0.8 Z"])])

    assert signed_volume(base) == pytest.approx(20 * 0.8)


def test_elephant_foot_needs_a_base_plate() -> None:
    with pytest.raises(InvalidParameters, match="needs a base plate"):
        _export(StlOptions(base_mm=0, elephant_foot_mm=0.2), [("#000000", [FRAME])])


def test_magnet_pocket_needs_room_in_the_plate() -> None:
    options = StlOptions(width_mm=40, base_mm=3, magnet_mm=12, magnet_depth_mm=2)

    with pytest.raises(InvalidParameters, match=r"fits at most 3\.9 mm"):
        _export(options, [("#000000", [FRAME])])  # 5 mm wide frame, widest in its corners


def test_magnet_pocket_fits_exactly_under_the_roof() -> None:
    square = "M0,0 L20,0 L20,20 L0,20 Z"
    options = StlOptions(width_mm=40, base_mm=2.4, magnet_mm=5, magnet_depth_mm=2)

    assert is_closed(_base(options, [("#000000", [square])]))


def test_magnet_pocket_needs_a_roof() -> None:
    options = StlOptions(width_mm=40, base_mm=2, magnet_mm=2, magnet_depth_mm=2)

    with pytest.raises(InvalidParameters, match=r"base plate of at least 2\.4 mm"):
        _export(options, [("#000000", [FRAME])])


# A traced region with a chain of sliver holes touching at their corners: valid in
# document px, but scaling to millimetres rounds two rings into crossing each other.
SLIVER_HOLES = (
    "M92.82853223593983,77.65706447187915 L92.82853223593983,81.65706447187915 "
    "L96.82853223593983,81.65706447187915 L96.82853223593983,77.65706447187915 Z "
    "M94.29766803840874,78.59533607681755 L94.0,78.0 L94.4522176497485,78.90443529949702 Z "
    "M94.70370370370372,79.40740740740742 L94.82853223593965,79.6570644718793 "
    "L94.4522176497485,78.90443529949702 Z "
    "M94.9122085048011,79.82441700960219 L94.92912665752172,79.85825331504343 "
    "L94.82853223593965,79.6570644718793 Z "
    "M94.99862825788752,79.99725651577504 L94.96296296296295,79.92592592592592 "
    "L94.92912665752172,79.85825331504343 Z"
)


@pytest.mark.parametrize("mirror", [False, True])
def test_geometry_made_invalid_by_scaling_is_repaired(mirror: bool) -> None:
    svg = contract_svg(512, 320, [("#dc273b", [SLIVER_HOLES])])
    bodies = build_bodies(parse_svg(svg), StlOptions(mirror=mirror))

    # the holes touch each other at points: separated, every body is manifold
    assert all(is_closed(body.triangles) for body in bodies)
    # a 4 x 4 px square at 100/512 mm per px, 1 mm base + 1 mm layer, minus tiny slivers
    # (the 0.78 mm model is pulled in by 2 µm where rings touch)
    volume = sum(signed_volume(body.triangles) for body in bodies)
    assert volume == pytest.approx((4 * 100 / 512) ** 2 * 2, rel=0.03)


# Two squares meeting at one corner, and a frame whose hole touches the outline.
CORNER_TOUCH = ["M0,0 L10,0 L10,10 L0,10 Z", "M10,10 L20,10 L20,20 L10,20 Z"]
HOLE_TOUCHING_OUTLINE = "M0,0 L20,0 L20,20 L0,20 Z M0,10 L10,5 L10,15 Z"


@pytest.mark.parametrize("paths", [CORNER_TOUCH, [HOLE_TOUCHING_OUTLINE]])
def test_rings_touching_at_a_point_extrude_into_manifold_bodies(paths: list[str]) -> None:
    document = parse_svg(contract_svg(40, 20, [("#000000", paths)]))
    bodies = build_bodies(document, StlOptions(width_mm=40, base_mm=1))

    assert all(is_closed(body.triangles) for body in bodies)
    assert all(signed_volume(body.triangles) > 0 for body in bodies)


def test_geometry_without_pinch_points_stays_exact() -> None:
    triangles = _export(StlOptions(width_mm=40, base_mm=0, layer_mm=2), [("#000000", [FRAME])])

    assert signed_volume(triangles) == pytest.approx(300 * 2, rel=1e-9)


SQUARE_A = "M0,0 L10,0 L10,10 L0,10 Z"
SQUARE_B = "M20,0 L30,0 L30,10 L20,10 Z"  # p-0-1: a separate element of the same color


def _two_squares() -> VectorDocument:
    return parse_svg(contract_svg(40, 20, [("#000000", [SQUARE_A, SQUARE_B])]))


def _tops(bodies: list[Body]) -> dict[str, float]:
    return {body.name: float(body.triangles[..., 2].max()) for body in bodies}


def test_shape_heights_raise_single_elements_above_their_color() -> None:
    options = StlOptions(width_mm=40, base_mm=1, layer_mm=0.6, shape_heights={"p-0-1": 2.4})
    bodies = build_bodies(_two_squares(), options)

    assert _tops(bodies) == pytest.approx({"base": 1, "color-0": 1.6, "color-0-2.4mm": 3.4})
    assert [body.color for body in bodies] == ["#000000"] * 3
    assert all(is_closed(body.triangles) for body in bodies)
    raised = bodies[2].triangles
    assert signed_volume(raised) == pytest.approx(10 * 10 * 2.4)  # only the raised square


def test_shape_heights_snap_to_printer_layers_and_zero_leaves_a_shape_out() -> None:
    options = StlOptions(width_mm=40, base_mm=0, shape_heights={"p-0-1": 0.5}, print_layer_mm=0.2)
    assert "color-0-0.6mm" in _tops(build_bodies(_two_squares(), options))

    omitted = build_bodies(_two_squares(), StlOptions(width_mm=40, shape_heights={"p-0-1": 0}))
    assert [body.name for body in omitted] == ["base", "color-0"]
    assert signed_volume(omitted[1].triangles) == pytest.approx(10 * 10 * 1)


def test_shape_heights_equal_to_the_color_or_unknown_ids_change_nothing() -> None:
    plain = build_bodies(_two_squares(), StlOptions(width_mm=40))
    same = build_bodies(_two_squares(), StlOptions(width_mm=40, shape_heights={"p-0-1": 1}))
    unknown = build_bodies(_two_squares(), StlOptions(width_mm=40, shape_heights={"x": 5}))

    assert [b.name for b in same] == [b.name for b in unknown] == [b.name for b in plain]


def test_a_shape_can_keep_its_height_when_its_color_is_left_out() -> None:
    options = StlOptions(width_mm=40, base_mm=1, layer_heights={0: 0}, shape_heights={"p-0-0": 2})
    bodies = build_bodies(_two_squares(), options)

    assert _tops(bodies) == pytest.approx({"base": 1, "color-0-2mm": 3})
    # the base plate only covers the included element
    assert signed_volume(bodies[0].triangles) == pytest.approx(10 * 10 * 1)


SQUARE = "M0,0 L20,0 L20,20 L0,20 Z"
PLACED = "M5,5 L15,5 L15,15 L5,15 Z"  # lies on top of SQUARE, e.g. a placed fragment


def test_shapes_drawn_above_cut_their_footprint_out_of_the_shapes_below() -> None:
    document = parse_svg(contract_svg(40, 20, [("#000000", [SQUARE]), ("#ff0000", [PLACED])]))

    bodies = build_bodies(document, StlOptions(width_mm=40, base_mm=0, layer_mm=2, layered=False))

    volumes = {body.name: signed_volume(body.triangles) for body in bodies}
    assert volumes == pytest.approx({"color-0": (400 - 100) * 2, "color-1": 100 * 2})
    assert all(is_closed(body.triangles) for body in bodies)


def test_the_document_order_decides_what_is_covered_whatever_the_stack_order() -> None:
    # White is drawn on top of gray; light_to_dark makes gray the higher color.
    document = parse_svg(contract_svg(40, 20, [("#808080", [SQUARE]), ("#ffffff", [PLACED])]))

    bodies = build_bodies(
        document, StlOptions(width_mm=40, base_mm=0, layer_mm=1, stack_order="light_to_dark")
    )

    volumes = {body.name: signed_volume(body.triangles) for body in bodies}
    assert volumes == pytest.approx({"color-1": 100 * 1, "color-0": (400 - 100) * 2})


def test_stack_slabs_put_thin_layers_on_top_of_the_base_filament() -> None:
    stack = ColorStack(base=0, top=((2, 0.16), (1, 0.08)))

    assert stack_slabs(stack, 0.8, 0.08) == [(2, 0.64, 0.8), (1, 0.56, 0.64), (0, 0.0, 0.56)]
    # thicknesses snap to printer layers; a low color keeps the topmost layers
    assert stack_slabs(ColorStack(0, ((1, 0.1),)), 0.4, 0.08) == [(1, 0.32, 0.4), (0, 0.0, 0.32)]
    assert stack_slabs(stack, 0.1, 0) == [(2, 0.0, 0.1)]
    assert stack_slabs(ColorStack(3), 1, 0.2) == [(3, 0.0, 1)]


MIXED = StlOptions(
    width_mm=40,
    base_mm=1,
    layer_mm=1,
    layered=False,
    filaments=("#ffffff", "#ff0000"),
    color_stacks={0: ColorStack(base=0), 1: ColorStack(base=0, top=((1, 0.4),))},
)


def test_mixed_colors_give_one_body_per_filament_and_height_range() -> None:
    document = parse_svg(contract_svg(40, 20, [("#000000", [FRAME]), ("#00ff00", [DOT])]))

    bodies = build_bodies(document, MIXED)

    assert [(body.name, body.color) for body in bodies] == [
        ("base", "#ffffff"),
        ("filament-1-0-0.6mm", "#ffffff"),
        ("filament-1-0-1mm", "#ffffff"),
        ("filament-2-0.6-1mm", "#ff0000"),
    ]
    volumes = [signed_volume(body.triangles) for body in bodies]
    # base under both (400 x 1), DOT: 0.6 white + 0.4 red, FRAME: 1.0 white
    assert volumes == pytest.approx([400, 100 * 0.6, 300 * 1, 100 * 0.4])
    assert all(is_closed(body.triangles) for body in bodies)


def test_mixed_colors_need_a_stack_of_loaded_filaments_for_every_color() -> None:
    document = parse_svg(contract_svg(40, 20, [("#000000", [FRAME]), ("#00ff00", [DOT])]))

    with pytest.raises(InvalidParameters, match="no filaments for color 1"):
        build_bodies(document, StlOptions(filaments=("#ffffff",), color_stacks={0: ColorStack(0)}))
    with pytest.raises(InvalidParameters, match="not loaded"):
        build_bodies(
            document,
            StlOptions(
                filaments=("#ffffff",),
                color_stacks={0: ColorStack(0), 1: ColorStack(0, ((1, 0.2),))},
            ),
        )


def test_stl_parts_put_every_body_in_a_file_of_its_own() -> None:
    document = parse_svg(contract_svg(40, 20, [("#000000", [FRAME]), ("#ff0000", [DOT])]))
    options = StlOptions(width_mm=40, base_mm=1, layer_mm=1, layered=False)

    with zipfile.ZipFile(io.BytesIO(export_stl_parts(document, options))) as archive:
        names = archive.namelist()
        files = {name: read_binary_stl(archive.read(name)) for name in names[:-1]}
        colors = archive.read("colors.txt").decode()

    assert names == [
        "01-base-000000.stl",
        "02-color-0-000000.stl",
        "03-color-1-ff0000.stl",
        "colors.txt",
    ]
    # file, color, filament (as in the 3MF), lowest and highest z, volume (mm³)
    assert colors.splitlines() == [
        "01-base-000000.stl\t#000000\t1\t0\t1\t400.0",  # follows the outline
        "02-color-0-000000.stl\t#000000\t1\t1\t2\t300.0",
        "03-color-1-ff0000.stl\t#ff0000\t2\t1\t2\t100.0",
    ]
    assert all(is_closed(triangles) for triangles in files.values())
    assert signed_volume(files["03-color-1-ff0000.stl"]) == pytest.approx(100)
    together = np.concatenate(list(files.values()))
    assert signed_volume(together) == pytest.approx(
        signed_volume(_export(options, [("#000000", [FRAME]), ("#ff0000", [DOT])]))
    )


def _z_range(body: Body) -> tuple[float, float]:
    return float(body.triangles[..., 2].min()), float(body.triangles[..., 2].max())


def test_inlay_sets_the_colors_flush_into_the_base_plate() -> None:
    options = StlOptions(width_mm=40, base_mm=3, layer_mm=1, relief="inlay")

    bodies = _bodies(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])

    # depths 1 (frame) and 2 (dot): solid plate below 1 mm, then the plate around the dot
    assert list(bodies) == ["base", "base-1-2mm", "color-0", "color-1"]
    assert all(is_closed(body.triangles) for body in bodies.values())
    z = {name: _z_range(body) for name, body in bodies.items()}
    assert z == {
        "base": (0.0, 1.0),
        "base-1-2mm": (1.0, 2.0),
        "color-0": (2.0, 3.0),
        "color-1": (1.0, 3.0),
    }
    assert signed_volume(bodies["base-1-2mm"].triangles) == pytest.approx(300)
    everything = np.concatenate([body.triangles for body in bodies.values()])
    assert is_balanced(everything)
    assert signed_volume(everything) == pytest.approx(400 * 3)  # a flush, solid block


def test_inlay_names_mixed_color_bodies_by_depth() -> None:
    options = StlOptions(
        width_mm=40,
        base_mm=2,
        layer_mm=1,
        relief="inlay",
        filaments=("#ffffff", "#ff0000"),
        color_stacks={0: ColorStack(base=1, top=((0, 0.4),))},
    )

    bodies = _bodies(options, [("#000000", [FRAME])])

    z = {name: _z_range(body) for name, body in bodies.items()}
    assert z["filament-1-inlay-0-0.4mm"] == pytest.approx((1.6, 2))
    assert z["filament-2-inlay-0.4-1mm"] == pytest.approx((1, 1.6))


def test_inlay_needs_a_plate_thicker_than_the_deepest_color() -> None:
    options = StlOptions(base_mm=2, layer_mm=1, relief="inlay")

    with pytest.raises(InvalidParameters, match=r"deepest color \(2 mm\)"):
        _export(options, [("#000000", [FRAME]), ("#ff0000", [DOT])])


def test_inlay_keeps_the_magnet_pocket_below_the_colors() -> None:
    options = StlOptions(base_mm=3, layer_mm=1, relief="inlay", magnet_mm=6, magnet_depth_mm=2)

    with pytest.raises(InvalidParameters, match="below the inlaid colors"):
        _export(options, [("#000000", [FRAME])])


GROUPS = [("#000000", [FRAME]), ("#ff0000", [DOT])]


def test_engraving_cuts_the_lettering_out_of_a_one_color_plate() -> None:
    # The red dot (the "lettering") is cut 1 mm into a 2 mm plate; the black frame,
    # left out with height 0, stays solid plate. No colored bodies: one filament.
    options = StlOptions(width_mm=40, base_mm=2, relief="engrave", layer_heights={0: 0, 1: 1})

    bodies = _bodies(options, GROUPS)

    assert list(bodies) == ["base", "base-1-2mm"]
    assert {body.color for body in bodies.values()} == {"#000000"}
    assert all(is_closed(body.triangles) for body in bodies.values())
    assert {name: _z_range(body) for name, body in bodies.items()} == {
        "base": (0.0, 1.0),
        "base-1-2mm": (1.0, 2.0),
    }
    # The plate follows the whole design (frame 300 + dot 100 mm²), the dot 1 mm deep.
    everything = np.concatenate([body.triangles for body in bodies.values()])
    assert signed_volume(everything) == pytest.approx(400 * 2 - 100 * 1)


def test_engraving_as_deep_as_the_plate_cuts_through() -> None:
    options = StlOptions(
        width_mm=40,
        base_mm=2,
        relief="engrave",
        base_shape="rectangle",
        layer_heights={0: 2, 1: 0},
    )

    bodies = _bodies(options, GROUPS)

    # A 40 x 20 mm stencil: the frame is a hole; its inside (10 x 10 mm, like the inside
    # of an "O") stays as a loose piece, printed but not held by the plate.
    assert list(bodies) == ["base-0-2mm"]
    assert _z_range(bodies["base-0-2mm"]) == (0.0, 2.0)
    assert signed_volume(bodies["base-0-2mm"].triangles) == pytest.approx((800 - 300) * 2)


def test_engraving_needs_a_plate_and_one_filament() -> None:
    with pytest.raises(InvalidParameters, match="deeper than the base plate"):
        _export(StlOptions(base_mm=2, relief="engrave", layer_heights={0: 3}), GROUPS)
    with pytest.raises(InvalidParameters, match="needs a base plate"):
        _export(StlOptions(base_mm=0, relief="engrave"), GROUPS)
    with pytest.raises(InvalidParameters, match="one filament"):
        _export(
            StlOptions(
                base_mm=2,
                relief="engrave",
                filaments=("#ffffff",),
                color_stacks={0: ColorStack(0), 1: ColorStack(0)},
            ),
            GROUPS,
        )


def test_center_origin_centers_the_footprint_on_zero() -> None:
    groups = [("#000000", [FRAME]), ("#ff0000", [DOT])]
    corner = _export(StlOptions(width_mm=40, base_mm=1, base_margin_mm=2), groups)

    centered = _export(
        StlOptions(width_mm=40, base_mm=1, base_margin_mm=2, origin="center"), groups
    )

    # outline plate grown by 2 mm around the 40 x 20 mm design: x -2..42, y -2..22
    assert np.allclose(centered, corner - [20, 10, 0])
    assert (centered[..., 0].min(), centered[..., 0].max()) == pytest.approx((-22, 22))
    assert (centered[..., 1].min(), centered[..., 1].max()) == pytest.approx((-12, 12))


def test_model_size_includes_the_base_plate_and_its_loop() -> None:
    document = parse_svg(contract_svg(40, 20, [("#112233", [FRAME]), ("#ff0000", [DOT])]))

    # 40 x 20 mm design, 1 mm base + two 1 mm color steps.
    plain = model_size(document, StlOptions(width_mm=40, base_mm=1, layer_mm=1))
    assert (plain.x_mm, plain.y_mm, plain.z_mm) == (40, 20, 3)
    # A 5 mm border on every side; a hanging loop sticks out at the top.
    framed = model_size(
        document,
        StlOptions(width_mm=40, base_mm=1, layer_mm=1, base_shape="rectangle", base_margin_mm=5),
    )
    assert (framed.x_mm, framed.y_mm) == (50, 30)
    looped = model_size(
        document,
        StlOptions(
            width_mm=40, base_mm=1, base_shape="rectangle", base_margin_mm=5, loop_hole_mm=4
        ),
    )
    assert looped.y_mm > 30 + 4


def test_hanging_loop_on_the_side_widens_the_model() -> None:
    document = parse_svg(contract_svg(40, 20, [("#112233", [FRAME])]))
    options = StlOptions(width_mm=40, base_mm=1, base_shape="rectangle", loop_hole_mm=4)

    plain = model_size(document, replace(options, loop_hole_mm=0))
    side = model_size(document, replace(options, loop_position="left"))

    # The ring (4 mm hole, 2 mm wall) sticks out 6 mm to the left; the height is unchanged.
    assert (side.x_mm, side.y_mm) == pytest.approx((plain.x_mm + 6, plain.y_mm), abs=0.01)


@pytest.mark.parametrize(
    ("copies", "grid"), [(1, (1, 1)), (2, (2, 1)), (4, (2, 2)), (5, (3, 2)), (10, (4, 3))]
)
def test_copies_fill_a_grid_as_square_as_possible(copies: int, grid: tuple[int, int]) -> None:
    assert copy_grid(copies) == grid


def test_copies_repeat_every_body_in_a_grid_on_the_bed() -> None:
    groups = [("#ffffff", ["M0,0 H40 V20 H0 Z"]), ("#ff0000", ["M10,5 H30 V15 H10 Z"])]
    one = _bodies(StlOptions(width_mm=40, base_mm=1, layer_mm=1), groups)
    six = _bodies(StlOptions(width_mm=40, base_mm=1, layer_mm=1, copies=6, copy_gap_mm=5), groups)

    assert list(six) == list(one)  # still one body per color
    for name in one:
        assert signed_volume(six[name].triangles) == pytest.approx(
            6 * signed_volume(one[name].triangles)
        )
        assert is_balanced(six[name].triangles)
    document = parse_svg(contract_svg(40, 20, groups))
    size = model_size(document, StlOptions(width_mm=40, copies=6, copy_gap_mm=5))
    assert (size.x_mm, size.y_mm) == (3 * 40 + 2 * 5, 2 * 20 + 5)
