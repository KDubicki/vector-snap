import math
from dataclasses import replace

import numpy as np
import pytest
from numpy.typing import NDArray

from app.core.errors import InvalidParameters
from app.services.cookie_cutter import CookieCutterOptions, export_cookie_cutter
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg, is_balanced, read_binary_stl, signed_volume

SQUARE = "M0,0 H40 V40 H0 Z"
FRAME = "M0,0 H40 V40 H0 Z M10,10 V30 H30 V10 Z"  # a square with a hole
OPTIONS = CookieCutterOptions(
    width_mm=40, height_mm=15, wall_mm=1, flange_mm=3, flange_height_mm=2, smooth_mm=0
)


def _ring_area(size: float, offset: float) -> float:
    """Area of a rounded ring `offset` wide around a size x size square."""
    return 4 * size * offset + math.pi * offset**2


def _cutter(paths: list[str], options: CookieCutterOptions = OPTIONS) -> NDArray[np.float64]:
    document = parse_svg(contract_svg(80, 40, [("#000000", paths)]))
    return read_binary_stl(export_cookie_cutter(document, options))


def test_blade_and_flange_around_the_outline() -> None:
    triangles = _cutter([SQUARE])

    assert is_balanced(triangles)
    blade = _ring_area(20, 1) * 13  # 40 px of 80 at 40 mm: a 20 mm square
    flange = _ring_area(20, 1 + 3) * 2
    assert signed_volume(triangles) == pytest.approx(blade + flange, rel=0.01)
    assert triangles[..., 2].max() == pytest.approx(15)
    assert triangles[..., :2].min() == pytest.approx(0)
    assert triangles[..., 0].max() == pytest.approx(20 + 2 * (1 + 3), abs=0.01)


def test_holes_are_filled() -> None:
    assert signed_volume(_cutter([FRAME])) == pytest.approx(signed_volume(_cutter([SQUARE])))


def test_without_flange_the_blade_stands_on_the_bed() -> None:
    options = CookieCutterOptions(width_mm=40, wall_mm=1, flange_mm=0, smooth_mm=0)
    triangles = _cutter([SQUARE], options)

    assert signed_volume(triangles) == pytest.approx(_ring_area(20, 1) * 15, rel=0.01)


def test_mirrored_by_default() -> None:
    # A large square on the left, a small one on the right: mirrored, the small one is left.
    paths = [SQUARE, "M60,0 H80 V20 H60 Z"]
    mirrored = _cutter(paths)
    plain = _cutter(paths, replace(OPTIONS, mirror=False))

    def left_depth(triangles: NDArray[np.float64]) -> float:
        points = triangles.reshape(-1, 3)
        left = points[points[:, 0] < 15]  # pieces 28 and 18 mm wide, 2 mm apart
        return float(np.ptp(left[:, 1]))

    assert left_depth(plain) == pytest.approx(20 + 2 * 4)
    assert left_depth(mirrored) == pytest.approx(10 + 2 * 4)


def test_specks_are_dropped_and_rules_checked() -> None:
    with pytest.raises(InvalidParameters):
        _cutter(["M0,0 H1 V1 H0 Z"])  # 0.25 mm²
    with pytest.raises(InvalidParameters):
        _cutter([SQUARE], CookieCutterOptions(height_mm=2, flange_height_mm=2))


def test_excluded_colors_are_left_out() -> None:
    document = parse_svg(
        contract_svg(80, 40, [("#ffffff", ["M0,0 H80 V40 H0 Z"]), ("#000000", [SQUARE])])
    )
    triangles = read_binary_stl(
        export_cookie_cutter(document, replace(OPTIONS, exclude=frozenset({0})))
    )

    assert signed_volume(triangles) == pytest.approx(signed_volume(_cutter([SQUARE])))
    with pytest.raises(InvalidParameters):
        export_cookie_cutter(document, replace(OPTIONS, exclude=frozenset({0, 1})))
