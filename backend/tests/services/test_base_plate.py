import pytest
from shapely import Point, Polygon, box

from app.core.errors import InvalidParameters
from app.services.base_plate import (
    LOOP_WALL_MM,
    MAGNET_WALL_MM,
    base_outline,
    magnet_pocket,
    printable,
    with_loop,
)

DESIGN = box(0, 0, 40, 20)


def test_printable_drops_parts_thinner_than_the_nozzle() -> None:
    thin_line = box(0, 30, 40, 30.2)

    kept = printable(DESIGN.union(thin_line), 0.4)

    assert kept.area == pytest.approx(DESIGN.area)
    assert printable(thin_line, 0).equals(thin_line)


def test_outline_follows_the_design_with_a_round_border() -> None:
    assert base_outline(DESIGN, "outline", 0).equals(DESIGN)
    grown = base_outline(DESIGN, "outline", 2)
    assert grown.bounds == pytest.approx((-2, -2, 42, 22))
    assert grown.area < 44 * 24  # round corners


def test_rectangle_rounded_and_circle_enclose_the_design() -> None:
    gap = box(0, 0, 10, 20).union(box(30, 0, 40, 20))  # two parts with a gap between

    rectangle = base_outline(gap, "rectangle", 1)
    assert rectangle.equals(box(-1, -1, 41, 21))
    rounded = base_outline(gap, "rounded", 1)
    assert rounded.bounds == pytest.approx(rectangle.bounds)
    assert rounded.area < rectangle.area
    circle = base_outline(gap, "circle", 0)
    assert circle.contains(gap)
    assert base_outline(Polygon(), "circle", 1).is_empty


def test_hanging_loop_sits_above_the_middle_with_an_open_hole() -> None:
    plate = with_loop(DESIGN, 4)

    hole_center = Point(20, 22)
    assert plate.bounds[3] == pytest.approx(20 + 4 + LOOP_WALL_MM, abs=0.01)
    assert not plate.contains(hole_center)
    assert plate.contains(Point(20, 20 + 4 + LOOP_WALL_MM / 2))
    assert with_loop(DESIGN, 0).equals(DESIGN)


def test_magnet_pocket_goes_to_the_widest_spot() -> None:
    pocket = magnet_pocket(DESIGN, 10)

    assert pocket is not None
    # Any point of the middle line is as far from the edge as possible (GEOS versions
    # pick different ones): 10 mm from the long sides.
    assert pocket.centroid.y == pytest.approx(10, abs=0.1)
    assert DESIGN.boundary.distance(pocket.centroid) == pytest.approx(10, abs=0.1)
    assert DESIGN.contains(pocket)
    assert magnet_pocket(DESIGN, 0) is None
    assert magnet_pocket(Polygon(), 10) is None


def test_magnet_pocket_needs_room_for_its_wall() -> None:
    fits = 20 - 2 * MAGNET_WALL_MM

    with pytest.raises(InvalidParameters, match=f"at most {fits:.1f} mm"):
        magnet_pocket(DESIGN, fits + 1)
