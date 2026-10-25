"""Split a 3D model larger than the printer's bed into tiles that each fit.

The model's footprint is divided into a grid of equal cells no larger than the bed, and
every cell is built like the whole model but clipped to it (`build_bodies(clip=...)`):
the base plate, rim, outlines and colors are cut at the cell's edges, so the printed
tiles fit edge to edge into the whole sign. Heights, holes and the loop stay where they
are on the whole model; magnet pockets crossed by a tile edge are left out. Every tile
is moved to start at x = y = 0 (or centered on 0 with `origin="center"`), so each one
lies on the bed as it is loaded. Tiles are
numbered by row from the top and column from the left, as the design is seen;
`export_tiles` packages every tile as a 3MF of its own in a ZIP. See
docs/13-export-formats.md#tiles.
"""

import io
import math
import zipfile
from dataclasses import dataclass, replace

import numpy as np
from shapely import box

from app.core.errors import InvalidParameters
from app.services.export_3mf import ThreeMfOptions, package_3mf
from app.services.export_stl import build_bodies
from app.services.model_options import Body, StlOptions
from app.services.svg_geometry import VectorDocument

# More tiles than this is not a sign but a floor.
MAX_TILES = 36
# The outer cells reach this far past the model (mm), so its edges are never clipped.
OUTER_SLACK_MM = 1.0


@dataclass(frozen=True)
class Tile:
    row: int  # 1 = top
    column: int  # 1 = left
    bodies: list[Body]


def _at_origin(bodies: list[Body], options: StlOptions) -> list[Body]:
    """A tile moved to start at x = y = 0; centered tiles already are (`build_bodies`)."""
    if options.origin == "center":
        return bodies
    points = np.concatenate([body.triangles.reshape(-1, 3) for body in bodies])
    shift = np.array([*points[:, :2].min(axis=0), 0.0])
    return [Body(body.name, body.color, body.triangles - shift) for body in bodies]


def grid_size(length_mm: float, tile_mm: float) -> int:
    """Tiles needed along one side: a little float slack, so exact fits stay one tile."""
    return max(1, math.ceil(length_mm / tile_mm - 1e-6))


def build_tiles(
    document: VectorDocument, options: StlOptions, tile_x_mm: float, tile_y_mm: float
) -> list[Tile]:
    """The model cut into the fewest equal tiles of at most `tile_x_mm` x `tile_y_mm`;
    cells the model leaves empty are skipped."""
    corner = replace(options, origin="corner")
    points = np.concatenate(
        [body.triangles.reshape(-1, 3) for body in build_bodies(document, corner)]
    )
    (low_x, low_y), (high_x, high_y) = points[:, :2].min(axis=0), points[:, :2].max(axis=0)
    columns = grid_size(high_x - low_x, tile_x_mm)
    rows = grid_size(high_y - low_y, tile_y_mm)
    if rows * columns > MAX_TILES:
        raise InvalidParameters(
            f"The model would need {rows * columns} tiles of at most {tile_x_mm:g} x "
            f"{tile_y_mm:g} mm; at most {MAX_TILES} are made. Make the model smaller.",
            {"field": "tile_x_mm"},
        )
    xs = np.linspace(low_x, high_x, columns + 1)
    ys = np.linspace(high_y, low_y, rows + 1)  # top down
    xs[0], xs[-1] = low_x - OUTER_SLACK_MM, high_x + OUTER_SLACK_MM
    ys[0], ys[-1] = high_y + OUTER_SLACK_MM, low_y - OUTER_SLACK_MM
    tiles: list[Tile] = []
    for row in range(rows):
        for column in range(columns):
            cell = box(xs[column], ys[row + 1], xs[column + 1], ys[row])
            bodies = build_bodies(document, options, clip=cell)
            if bodies:
                tiles.append(Tile(row + 1, column + 1, _at_origin(bodies, options)))
    return tiles


def _footprint(bodies: list[Body]) -> tuple[float, float]:
    points = np.concatenate([body.triangles.reshape(-1, 3) for body in bodies])
    x, y = (points[:, :2].max(axis=0) - points[:, :2].min(axis=0)).round(1).tolist()
    return x, y


def export_tiles(
    document: VectorDocument,
    options: StlOptions,
    package_options: ThreeMfOptions,
    tile_x_mm: float,
    tile_y_mm: float,
) -> bytes:
    """A ZIP of one 3MF per tile, named by row and column, and `tiles.txt` listing them
    tab-separated: file, row, column, width and depth (mm)."""
    buffer = io.BytesIO()
    lines = []
    title = package_options.title or "VectorSnap"
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for tile in build_tiles(document, options, tile_x_mm, tile_y_mm):
            name = f"tile-r{tile.row}-c{tile.column}.3mf"
            tile_title = f"{title} (row {tile.row}, column {tile.column})"
            package = replace(package_options, title=tile_title)
            archive.writestr(name, package_3mf(tile.bodies, package))
            x, y = _footprint(tile.bodies)
            lines.append("\t".join([name, str(tile.row), str(tile.column), f"{x:g}", f"{y:g}"]))
        archive.writestr("tiles.txt", "\n".join(lines) + "\n")
    return buffer.getvalue()
