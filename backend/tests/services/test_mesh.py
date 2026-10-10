import numpy as np
import pytest
from shapely import Polygon, box

from app.services.mesh import (
    PINCH_SEPARATION_MM,
    has_pinches,
    prism,
    without_pinches,
    write_binary_stl,
)
from tests.vectors import is_closed, read_binary_stl, signed_volume

FRAME = Polygon(
    [(0, 0), (20, 0), (20, 20), (0, 20)], [[(5, 5), (5, 15), (15, 15), (15, 5)]]
)  # 20 x 20 with a 10 x 10 hole


def test_prism_is_a_closed_outward_facing_solid() -> None:
    mesh = prism(FRAME, 1, 3)

    assert is_closed(mesh)
    assert signed_volume(mesh) == pytest.approx(300 * 2)
    assert mesh[..., 2].min() == 1
    assert mesh[..., 2].max() == 3


def test_prism_orientation_does_not_depend_on_ring_direction() -> None:
    clockwise = Polygon(list(FRAME.exterior.coords)[::-1], [list(FRAME.interiors[0].coords)])

    assert signed_volume(prism(clockwise, 0, 1)) == pytest.approx(300)


def test_pocket_is_recessed_into_the_bottom() -> None:
    pocket = box(1, 1, 3, 3)

    mesh = prism(FRAME, 0, 2, pocket, 0.5)

    assert is_closed(mesh)
    assert signed_volume(mesh) == pytest.approx(300 * 2 - 4 * 0.5)


def test_binary_stl_has_a_header_count_and_unit_normals() -> None:
    data = write_binary_stl([prism(box(0, 0, 1, 1), 0, 1)])

    assert data[:21] == b"VectorSnap STL export"
    assert int.from_bytes(data[80:84], "little") == 12
    normals = np.frombuffer(data[84:], dtype=np.dtype([("n", "<f4", 3), ("rest", "V38")]))["n"]
    assert np.allclose(np.linalg.norm(normals, axis=1), 1)
    assert read_binary_stl(data).shape == (12, 3, 3)


def test_empty_and_degenerate_stl() -> None:
    assert len(write_binary_stl([])) == 84
    flat = np.array([[[0, 0, 0], [1, 0, 0], [2, 0, 0]]], dtype=np.float64)
    data = write_binary_stl([flat])
    assert np.frombuffer(data[84:96], dtype="<f4").tolist() == [0, 0, 0]


def test_rings_touching_at_a_point_are_pulled_apart() -> None:
    corners = box(0, 0, 1, 1).union(box(1, 1, 2, 2))

    assert has_pinches(list(corners.geoms))
    parts = without_pinches(corners)
    assert len(parts) == 2
    assert parts[0].distance(parts[1]) == pytest.approx(2 * PINCH_SEPARATION_MM * 2**0.5, rel=0.01)


def test_geometry_without_pinches_stays_exact() -> None:
    shapes = without_pinches(FRAME)

    assert not has_pinches(shapes)
    assert shapes[0].equals(FRAME)
