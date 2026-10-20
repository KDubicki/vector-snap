import pytest
from shapely import Point, Polygon, box

from app.core.errors import InvalidParameters
from app.services.base_plate import (
    LOOP_WALL_MM,
    MAGNET_WALL_MM,
    LoopPosition,
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


@pytest.mark.parametrize(
    ("position", "bounds", "hole"),
    [
        ("right", (0, 0, 46, 20), (42, 10)),
        ("bottom", (0, -6, 40, 20), (20, -2)),
        ("left", (-6, 0, 40, 20), (-2, 10)),
    ],
)
def test_hanging_loop_can_stick_out_of_any_side(
    position: LoopPosition, bounds: tuple[float, ...], hole: tuple[float, float]
) -> None:
    plate = with_loop(DESIGN, 4, position)

    # Only the chosen side grows, by the hole and one wall; the hole stays open.
    assert plate.bounds == pytest.approx(bounds, abs=0.01)
    assert not plate.contains(Point(hole))


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


def test_rounded_plate_keeps_designs_that_reach_into_the_corners() -> None:
    # A rectangular design fills its bounding box: with a plain rounded plate its corners
    # would stick out of the plate.
    without_margin = base_outline(DESIGN, "rounded", 0)
    assert without_margin.equals(DESIGN)  # no margin: no room for round corners

    with_margin = base_outline(DESIGN, "rounded", 1)
    assert with_margin.covers(DESIGN)
    assert with_margin.area < 42 * 22  # still rounded

    roundish = Point(20, 10).buffer(10)  # far from the corners: the full radius
    full = base_outline(roundish, "rounded", 0)
    assert full.covers(roundish)
    assert full.area < 20 * 20 - 3  # corner radius 3 mm (15 % of 20)
