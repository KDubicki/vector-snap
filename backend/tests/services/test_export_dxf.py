import io

import pytest
from ezdxf.document import Drawing
from ezdxf.entities.hatch import Hatch
from ezdxf.entities.lwpolyline import LWPolyline
from ezdxf.filemanagement import read
from ezdxf.layouts.layout import Modelspace

from app.services.export_dxf import DxfOptions, export_dxf
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg

FRAME = "M0,0 L20,0 L20,20 L0,20 Z M5,5 L5,15 L15,15 L15,5 Z"
HALVES = ["M30,0 L35,0 L35,10 L30,10 Z", "M35,0 L40,0 L40,10 L35,10 Z"]


def _read(options: DxfOptions) -> Drawing:
    svg = contract_svg(40, 20, [("#112233", [FRAME]), ("#FF0000", HALVES)])
    return read(io.StringIO(export_dxf(parse_svg(svg), options).decode()))


def _polylines(modelspace: Modelspace, layer: str) -> list[LWPolyline]:
    query = modelspace.query(f'LWPOLYLINE[layer=="{layer}"]')
    return [entity for entity in query if isinstance(entity, LWPolyline)]


def _hatches(modelspace: Modelspace) -> list[Hatch]:
    return [entity for entity in modelspace.query("HATCH") if isinstance(entity, Hatch)]


def test_one_layer_per_color_with_true_colors_and_mm_units() -> None:
    drawing = _read(DxfOptions(width_mm=80))

    assert drawing.header["$INSUNITS"] == 4
    layers = {
        layer.dxf.name: layer.rgb for layer in drawing.layers if layer.dxf.name.startswith("color-")
    }
    assert layers == {"color-0": (0x11, 0x22, 0x33), "color-1": (255, 0, 0)}


def test_outlines_are_closed_polylines_including_holes() -> None:
    modelspace = _read(DxfOptions(width_mm=40)).modelspace()

    frame = _polylines(modelspace, "color-0")
    assert len(frame) == 2  # outline + hole
    assert all(polyline.closed for polyline in frame)
    # adjacent halves of one color are merged into a single outline (no double cut)
    assert len(_polylines(modelspace, "color-1")) == 1
    assert not _hatches(modelspace)


def test_scales_to_width_and_flips_the_y_axis() -> None:
    modelspace = _read(DxfOptions(width_mm=80)).modelspace()

    points = [p for e in _polylines(modelspace, "color-1") for p in e.get_points("xy")]
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    # 10x10 px at the top-right of a 40x20 px document -> 20x20 mm, y flipped
    assert (min(xs), max(xs)) == pytest.approx((60, 80))
    assert (min(ys), max(ys)) == pytest.approx((20, 40))


def test_optional_solid_hatch_fill_with_holes() -> None:
    modelspace = _read(DxfOptions(width_mm=40, fill=True)).modelspace()

    hatches = _hatches(modelspace)
    assert len(hatches) == 2
    frame_hatch = next(h for h in hatches if h.dxf.layer == "color-0")
    assert frame_hatch.dxf.solid_fill == 1
    assert len(frame_hatch.paths) == 2  # outer boundary + hole


@pytest.mark.parametrize("fill", [False, True])
def test_output_passes_the_ezdxf_audit(fill: bool) -> None:
    auditor = _read(DxfOptions(fill=fill)).audit()

    assert not auditor.has_errors
    assert not auditor.has_fixes
