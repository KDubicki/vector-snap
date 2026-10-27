import io
import zipfile

import numpy as np
import pytest

from app.core.errors import InvalidParameters
from app.services.export_3mf import ThreeMfOptions
from app.services.export_stl import build_bodies
from app.services.model_options import Body, StlOptions
from app.services.svg_geometry import VectorDocument, parse_svg
from app.services.tiles import build_tiles, export_tiles, grid_size
from tests.vectors import contract_svg, is_closed, signed_volume

PLATE = "M0,0 H40 V20 H0 Z"
CORNERS = ["M0,0 H5 V5 H0 Z", "M37,17 H40 V20 H37 Z"]  # 5 mm top left, 3 mm bottom right


def _document(groups: list[tuple[str, list[str]]]) -> VectorDocument:
    return parse_svg(contract_svg(40, 20, groups))


def _volume(bodies: list[Body]) -> float:
    return sum(signed_volume(body.triangles) for body in bodies)


def _x_range(bodies: list[Body]) -> tuple[float, float]:
    x = np.concatenate([body.triangles[..., 0].ravel() for body in bodies])
    return round(float(x.min()), 6), round(float(x.max()), 6)


def test_grid_size_keeps_an_exact_fit_in_one_tile() -> None:
    assert grid_size(220, 220) == 1
    assert grid_size(220.0000001, 220) == 1
    assert grid_size(221, 220) == 2
    assert grid_size(500, 220) == 3


def test_cuts_the_model_into_equal_tiles_that_add_up_to_it() -> None:
    document = _document([("#000000", [PLATE]), ("#ff0000", ["M10,5 H30 V15 H10 Z"])])
    options = StlOptions(width_mm=40, base_mm=1, layer_mm=1)

    tiles = build_tiles(document, options, 25, 25)

    assert [(tile.row, tile.column) for tile in tiles] == [(1, 1), (1, 2)]
    assert [_x_range(tile.bodies) for tile in tiles] == [(0, 20), (0, 20)]  # each from 0
    assert all(is_closed(body.triangles) for tile in tiles for body in tile.bodies)
    whole = _volume(build_bodies(document, options))
    assert sum(_volume(tile.bodies) for tile in tiles) == pytest.approx(whole)


def test_numbers_rows_from_the_top_and_skips_empty_cells() -> None:
    document = _document([("#000000", CORNERS)])

    tiles = build_tiles(document, StlOptions(width_mm=40, base_mm=1), 20, 10)

    assert [(tile.row, tile.column) for tile in tiles] == [(1, 1), (2, 2)]
    # y points up: the top left tile holds the square drawn at the top left.
    assert [_x_range(tile.bodies) for tile in tiles] == [(0, 5), (0, 3)]


def test_centered_tiles_stay_centered() -> None:
    document = _document([("#000000", [PLATE])])

    tiles = build_tiles(document, StlOptions(width_mm=40, origin="center"), 20, 20)

    assert [_x_range(tile.bodies) for tile in tiles] == [(-10, 10), (-10, 10)]


def test_outlines_follow_the_whole_design_not_the_tile_edges() -> None:
    document = _document([("#000000", [PLATE])])
    options = StlOptions(width_mm=40, base_mm=1, outline_mm=1)

    def outline(bodies: list[Body]) -> float:
        return _volume([body for body in bodies if body.name == "outline"])

    tiles = build_tiles(document, options, 20, 20)

    whole = outline(build_bodies(document, options))
    assert sum(outline(tile.bodies) for tile in tiles) == pytest.approx(whole)


def test_leaves_out_a_magnet_pocket_crossed_by_a_tile_edge() -> None:
    document = _document([("#000000", [PLATE])])
    options = StlOptions(width_mm=40, base_mm=3, magnet_mm=6, magnet_depth_mm=2)

    # The pocket spans x = 7..13; tiles 10 mm wide cut it at x = 10.
    tiles = build_tiles(document, options, 10, 20)

    assert len(tiles) == 4
    solid = _volume(build_bodies(document, StlOptions(width_mm=40, base_mm=3)))
    assert sum(_volume(tile.bodies) for tile in tiles) == pytest.approx(solid)


def test_refuses_more_tiles_than_a_sign_needs() -> None:
    with pytest.raises(InvalidParameters, match="37 tiles") as error:
        build_tiles(_document([("#000000", [PLATE])]), StlOptions(width_mm=370), 10, 1000)

    assert error.value.details == {"field": "tile_x_mm"}


def test_exports_a_3mf_per_tile_and_lists_them() -> None:
    document = _document([("#000000", [PLATE])])
    options = StlOptions(width_mm=40, base_mm=1)

    data = export_tiles(document, options, ThreeMfOptions(title="Sign"), 20, 20)

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.namelist() == ["tile-r1-c1.3mf", "tile-r1-c2.3mf", "tiles.txt"]
        listing = archive.read("tiles.txt").decode()
        with zipfile.ZipFile(io.BytesIO(archive.read("tile-r1-c2.3mf"))) as package:
            model = package.read("3D/3dmodel.model").decode()
    assert listing == "tile-r1-c1.3mf\t1\t1\t20\t20\ntile-r1-c2.3mf\t1\t2\t20\t20\n"
    assert "Sign (row 1, column 2)" in model


def test_tiles_do_not_take_copies() -> None:
    with pytest.raises(InvalidParameters, match="copies of each tile"):
        build_tiles(_document([("#000000", [PLATE])]), StlOptions(width_mm=40, copies=2), 20, 20)
