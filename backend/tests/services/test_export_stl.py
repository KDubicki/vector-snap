import numpy as np
import pytest

from app.services.export_stl import StlOptions, export_stl
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
