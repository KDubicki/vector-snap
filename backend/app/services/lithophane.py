"""Lithophane export: a thin plate whose thickness follows the brightness of a photo.

Held against a light, thick (dark) areas let less light through, so the print shows the
image. Unlike the STL/3MF exports, this works on the original raster, not on the SVG.
See docs/13-export-formats.md.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from app.core.errors import InvalidParameters
from app.services.image_io import DecodedImage
from app.services.mesh import write_binary_stl

# Upper bound for the height grid: ~2 triangles per point, 50 bytes each (~100 MB).
MAX_GRID_POINTS = 1_000_000

# Rec. 709 luma weights on the gamma-encoded channels.
_LUMA = np.array([0.2126, 0.7152, 0.0722])


@dataclass(frozen=True)
class LithophaneOptions:
    width_mm: float = 100.0
    min_thickness_mm: float = 0.8  # brightest areas
    max_thickness_mm: float = 3.0  # darkest areas (and the frame)
    resolution_mm: float = 0.2  # grid spacing
    frame_mm: float = 0.0  # solid border at max thickness around the image
    invert: bool = False  # bright areas thick: a relief instead of a lithophane


def thickness_map(image: DecodedImage, options: LithophaneOptions) -> NDArray[np.float64]:
    """Plate thickness per grid point (rows top to bottom), including the frame."""
    if options.max_thickness_mm <= options.min_thickness_mm:
        raise InvalidParameters(
            "The maximum thickness must be greater than the minimum thickness.",
            {"field": "max_thickness_mm"},
        )
    cols = max(2, round(options.width_mm / options.resolution_mm) + 1)
    rows = max(2, round(cols * image.height / image.width))
    frame = round(options.frame_mm / options.resolution_mm)
    points = (cols + 2 * frame) * (rows + 2 * frame)
    if points > MAX_GRID_POINTS:
        raise InvalidParameters(
            f"The model would need {points:,} points (at most {MAX_GRID_POINTS:,}); "
            "use a coarser resolution or a smaller width.",
            {"field": "resolution_mm", "points": points, "max_points": MAX_GRID_POINTS},
        )

    # Transparent pixels were composited over white by decode_image: they print thin.
    gray = Image.fromarray((image.rgb @ _LUMA).astype(np.float32), mode="F")
    brightness = np.asarray(gray.resize((cols, rows), Image.Resampling.BILINEAR)) / 255.0
    brightness = np.clip(brightness, 0.0, 1.0)
    if options.invert:
        brightness = 1.0 - brightness
    span = options.max_thickness_mm - options.min_thickness_mm
    thickness = options.max_thickness_mm - span * brightness.astype(np.float64)
    if frame:
        thickness = np.pad(thickness, frame, constant_values=options.max_thickness_mm)
    return thickness


def _boundary(rows: int, cols: int) -> NDArray[np.intp]:
    """Flat indices of the grid border, counter-clockwise seen from above (y up)."""
    grid = np.arange(rows * cols).reshape(rows, cols)
    return np.concatenate(
        [
            grid[-1, :-1],  # bottom edge, left to right
            grid[:0:-1, -1],  # right edge, upwards
            grid[0, :0:-1],  # top edge, right to left
            grid[:-1, 0],  # left edge, downwards
        ]
    )


def lithophane_triangles(thickness: NDArray[np.float64], spacing_mm: float) -> NDArray[np.float64]:
    """Closed, outward-facing mesh: height-mapped top, flat bottom at z = 0, side walls."""
    rows, cols = thickness.shape
    xs = np.arange(cols) * spacing_mm
    ys = (rows - 1 - np.arange(rows)) * spacing_mm
    grid_x, grid_y = np.meshgrid(xs, ys)
    top = np.stack([grid_x, grid_y, thickness], axis=-1).reshape(-1, 3)

    index = np.arange(rows * cols).reshape(rows, cols)
    a, b = index[:-1, :-1].ravel(), index[:-1, 1:].ravel()  # upper row of each cell
    c, d = index[1:, :-1].ravel(), index[1:, 1:].ravel()  # lower row (smaller y)
    top_faces = np.concatenate([np.stack([c, d, b], 1), np.stack([c, b, a], 1)])

    ring = _boundary(rows, cols)
    upper = top[ring]
    lower = upper * np.array([1.0, 1.0, 0.0])
    upper_next, lower_next = np.roll(upper, -1, axis=0), np.roll(lower, -1, axis=0)
    walls = np.concatenate(
        [
            np.stack([lower, lower_next, upper_next], axis=1),
            np.stack([lower, upper_next, upper], axis=1),
        ]
    )
    center = np.array([xs[-1] / 2, ys[0] / 2, 0.0])
    bottom = np.stack([np.broadcast_to(center, lower.shape), lower_next, lower], axis=1)
    return np.concatenate([top[top_faces], walls, bottom])


def export_lithophane(image: DecodedImage, options: LithophaneOptions) -> bytes:
    """Binary STL of the lithophane (millimetres, flat side down)."""
    thickness = thickness_map(image, options)
    return write_binary_stl([lithophane_triangles(thickness, options.resolution_mm)])
