import numpy as np
import pytest

from app.core.errors import InvalidParameters
from app.services.image_io import DecodedImage
from app.services.lithophane import (
    LithophaneOptions,
    export_lithophane,
    lithophane_triangles,
    thickness_map,
)
from tests.vectors import is_closed, read_binary_stl, signed_volume


def _image(rgb: list[list[tuple[int, int, int]]]) -> DecodedImage:
    pixels = np.array(rgb, dtype=np.uint8)
    height, width = pixels.shape[:2]
    return DecodedImage(
        rgb=pixels,
        alpha_mask=np.ones((height, width), dtype=bool),
        width=width,
        height=height,
        is_indexed=False,
    )


BLACK, WHITE = (0, 0, 0), (255, 255, 255)
# Left half black, right half white.
HALVES = _image([[BLACK] * 10 + [WHITE] * 10] * 20)


def test_dark_areas_are_thick_and_bright_areas_thin() -> None:
    options = LithophaneOptions(width_mm=19, resolution_mm=1)
    thickness = thickness_map(HALVES, options)

    assert thickness.shape == (20, 20)
    assert thickness[:, 0] == pytest.approx(3.0)
    assert thickness[:, -1] == pytest.approx(0.8)


def test_invert_makes_bright_areas_thick() -> None:
    options = LithophaneOptions(width_mm=19, resolution_mm=1, invert=True)
    thickness = thickness_map(HALVES, options)

    assert thickness[0, 0] == pytest.approx(0.8)
    assert thickness[0, -1] == pytest.approx(3.0)


def test_frame_surrounds_the_image_at_full_thickness() -> None:
    options = LithophaneOptions(width_mm=19, resolution_mm=1, frame_mm=2)
    thickness = thickness_map(_image([[WHITE] * 4] * 4), options)

    assert thickness.shape == (24, 24)
    assert (thickness[:2] == 3.0).all() and (thickness[:, -2:] == 3.0).all()
    assert thickness[2:-2, 2:-2] == pytest.approx(0.8)


def test_rows_follow_the_image_aspect_ratio() -> None:
    wide = _image([[WHITE] * 40] * 10)

    assert thickness_map(wide, LithophaneOptions(width_mm=99, resolution_mm=1)).shape == (25, 100)


def test_rejects_inverted_thickness_range() -> None:
    with pytest.raises(InvalidParameters, match="greater than the minimum") as error:
        thickness_map(HALVES, LithophaneOptions(min_thickness_mm=2, max_thickness_mm=2))
    assert error.value.details["field"] == "max_thickness_mm"


def test_rejects_grids_that_are_too_large() -> None:
    with pytest.raises(InvalidParameters, match="coarser resolution") as error:
        thickness_map(HALVES, LithophaneOptions(width_mm=1000, resolution_mm=0.05))
    assert error.value.details["field"] == "resolution_mm"


def test_mesh_is_closed_with_outward_normals() -> None:
    thickness = np.array([[1.0, 2.0, 1.5], [3.0, 0.5, 1.0]])
    triangles = lithophane_triangles(thickness, 2.0)

    assert is_closed(triangles)
    # 2 x 1 cells of 2 mm: prism volumes averaged over each triangle of the top surface
    assert signed_volume(triangles) > 0
    assert triangles[..., 2].min() == 0
    assert triangles[..., 2].max() == 3.0


def test_flat_plate_volume() -> None:
    triangles = lithophane_triangles(np.full((4, 6), 1.5), 0.5)

    assert is_closed(triangles)
    assert signed_volume(triangles) == pytest.approx(2.5 * 1.5 * 1.5)


def test_exports_binary_stl_in_millimetres() -> None:
    options = LithophaneOptions(width_mm=19, resolution_mm=1)
    triangles = read_binary_stl(export_lithophane(HALVES, options))

    assert is_closed(triangles)
    size = triangles.reshape(-1, 3).max(axis=0) - triangles.reshape(-1, 3).min(axis=0)
    assert size == pytest.approx([19, 19, 3.0])
