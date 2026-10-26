import io
import zipfile

import pytest
from ezdxf.entities.lwpolyline import LWPolyline
from ezdxf.filemanagement import read as read_dxf

from app.services.export_layers import LayersOptions, color_documents, export_layers
from app.services.svg_geometry import parse_svg
from tests.vectors import SVG_NS

DOCUMENT = parse_svg(
    (
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 40 20">'
        '<g data-palette-index="0" fill="#000000"><path id="a" d="M0,0 H20 V20 H0 Z"/>'
        '<path id="b" d="M30,10 h10 v10 h-10 z" fill="#ff0000"/></g>'
        '<g data-palette-index="1" fill="#ff0000"><path id="c" d="M30,0 h10 v10 h-10 z"/></g>'
        "</svg>"
    ).encode()
)


def _files(options: LayersOptions) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(export_layers(DOCUMENT, options))) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def test_splits_by_color_in_order_of_appearance() -> None:
    documents = color_documents(DOCUMENT)

    assert [d.layers[0].fill for d in documents] == ["#000000", "#ff0000"]
    assert [[s.id for s in d.layers[0].shapes] for d in documents] == [["a"], ["b", "c"]]
    assert all((d.width, d.height) == (40, 20) for d in documents)


def test_svg_files_keep_the_canvas() -> None:
    files = _files(LayersOptions())

    assert sorted(files) == ["color-01-000000.svg", "color-02-ff0000.svg", "colors.txt"]
    red = parse_svg(files["color-02-ff0000.svg"])
    assert (red.width, red.height) == (40, 20)
    assert [layer.fill for layer in red.layers] == ["#ff0000"]
    assert files["colors.txt"].decode().splitlines() == [
        "file\tcolor\tshapes\tarea_mm2",
        "color-01-000000.svg\t#000000\t1\t2500.0",  # 20 x 20 px at 2.5 mm/px
        "color-02-ff0000.svg\t#ff0000\t2\t1250.0",
    ]


def test_dxf_files_share_coordinates() -> None:
    files = _files(LayersOptions(layer_format="dxf", width_mm=40))
    red = read_dxf(io.StringIO(files["color-02-ff0000.dxf"].decode()))
    polylines = [e for e in red.modelspace().query("LWPOLYLINE") if isinstance(e, LWPolyline)]
    xs = [x for polyline in polylines for x, _ in polyline.get_points("xy")]

    assert min(xs) == pytest.approx(30)
    assert max(xs) == pytest.approx(40)


def test_pdf_files() -> None:
    files = _files(LayersOptions(layer_format="pdf", margin_mm=5))

    assert all(files[name].startswith(b"%PDF") for name in files if name.endswith(".pdf"))
    assert len(files) == 3
