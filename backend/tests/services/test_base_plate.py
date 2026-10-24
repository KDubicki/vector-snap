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
from app.services.svg_geometry import polygons

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


def test_oval_passes_the_corners_of_the_grown_bounding_box() -> None:
    oval = base_outline(DESIGN, "oval", 1)

    assert oval.contains(box(-1, -1, 41, 21).buffer(-0.01))
    # Half sides 21 x 11 grown by √2, centered on the design.
    assert oval.bounds == pytest.approx(
        (20 - 21 * 2**0.5, 10 - 11 * 2**0.5, 20 + 21 * 2**0.5, 10 + 11 * 2**0.5), abs=0.05
    )
    assert oval.area < 4 * 21 * 11 * 2  # an ellipse, not its bounding box


def test_hexagon_is_regular_with_a_flat_top_around_the_design() -> None:
    hexagon = base_outline(DESIGN, "hexagon", 2)

    assert hexagon.contains(DESIGN.buffer(2 - 0.01))
    points = list(hexagon.exterior.coords)[:-1]
    sides = [
        Point(a).distance(Point(b)) for a, b in zip(points, points[1:] + points[:1], strict=True)
    ]
    assert sides == pytest.approx([sides[0]] * 6)
    # Flat top: two corners at the highest y, centered over the design.
    top = max(y for _, y in points)
    assert sum(1 for _, y in points if y == pytest.approx(top)) == 2
    assert hexagon.centroid.x == pytest.approx(20)
    # Tight: the grown design touches at least one side.
    assert hexagon.boundary.distance(DESIGN) == pytest.approx(2, abs=0.05)


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


def test_magnets_are_spread_along_the_longer_side() -> None:
    pockets = magnet_pocket(DESIGN, 8, 2)

    assert pockets is not None
    centers = sorted(
        (round(part.centroid.x, 1), round(part.centroid.y, 1)) for part in polygons(pockets)
    )
    assert centers == [(10, 10), (30, 10)]
    # Upright plates get them one above the other.
    upright = magnet_pocket(box(0, 0, 20, 40), 8, 2)
    assert upright is not None
    assert sorted(round(part.centroid.y, 1) for part in polygons(upright)) == [10, 30]


def test_magnets_need_room_between_them_and_to_the_edge() -> None:
    with pytest.raises(InvalidParameters, match="No room for 4 magnets of 10 mm"):
        magnet_pocket(DESIGN, 10, 4)
    with pytest.raises(InvalidParameters, match="No room for 2 magnets"):
        magnet_pocket(DESIGN, 19, 2)


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
