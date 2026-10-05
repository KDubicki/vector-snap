import io
import zipfile

import numpy as np
import pytest
from lxml import etree

from app.services.export_3mf import CORE_NS, MODEL_PATH, export_3mf, indexed_mesh
from app.services.export_stl import StlOptions, export_stl
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg, read_binary_stl, signed_volume

FRAME = "M0,0 L20,0 L20,20 L0,20 Z M5,5 L5,15 L15,15 L15,5 Z"
DOT = "M30,0 L40,0 L40,10 L30,10 Z"
SVG = contract_svg(40, 20, [("#112233", [FRAME]), ("#ff0000", [DOT])])
NS = {"m": CORE_NS}


def _model(options: StlOptions) -> etree._Element:
    with zipfile.ZipFile(io.BytesIO(export_3mf(parse_svg(SVG), options))) as package:
        assert {"[Content_Types].xml", "_rels/.rels", MODEL_PATH} <= set(package.namelist())
        assert b"3dmodel.model" in package.read("_rels/.rels")
        return etree.fromstring(package.read(MODEL_PATH))


def _mesh(obj: etree._Element) -> tuple[np.ndarray, np.ndarray]:
    vertices = np.array(
        [
            [float(v.get(axis)) for axis in "xyz"]
            for v in obj.iterfind("m:mesh/m:vertices/m:vertex", NS)
        ]
    )
    faces = np.array(
        [
            [int(t.get(k)) for k in ("v1", "v2", "v3")]
            for t in obj.iterfind("m:mesh/m:triangles/m:triangle", NS)
        ]
    )
    return vertices, faces


def test_one_colored_part_per_body_in_one_assembly() -> None:
    model = _model(StlOptions(width_mm=40, base_mm=1))

    assert model.get("unit") == "millimeter"
    colors = [
        b.get("displaycolor") for b in model.iterfind("m:resources/m:basematerials/m:base", NS)
    ]
    assert colors == ["#112233FF", "#112233FF", "#FF0000FF"]  # base takes the bottom color

    parts = [
        o for o in model.iterfind("m:resources/m:object", NS) if o.find("m:mesh", NS) is not None
    ]
    assert [(p.get("name"), p.get("pid"), p.get("pindex")) for p in parts] == [
        ("base", "1", "0"),
        ("color-0", "1", "1"),
        ("color-1", "1", "2"),
    ]
    assembly = model.find("m:resources/m:object/m:components", NS).getparent()
    component_ids = [c.get("objectid") for c in assembly.iterfind("m:components/m:component", NS)]
    assert component_ids == [p.get("id") for p in parts]
    items = model.findall("m:build/m:item", NS)
    assert [item.get("objectid") for item in items] == [assembly.get("id")]


def test_every_part_is_a_closed_indexed_mesh_with_the_stl_volume() -> None:
    options = StlOptions(width_mm=40, base_mm=1, layer_mm=0.5)
    model = _model(options)

    total = 0.0
    for obj in model.iterfind("m:resources/m:object", NS):
        if obj.find("m:mesh", NS) is None:
            continue
        vertices, faces = _mesh(obj)
        assert len(vertices) < len(faces) * 3  # vertices are shared
        edges = {(a, b) for f in faces for a, b in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0]))}
        assert len(edges) == len(faces) * 3  # no directed edge used twice
        assert all((b, a) in edges for a, b in edges)  # closed
        total += signed_volume(vertices[faces])

    stl = read_binary_stl(export_stl(parse_svg(SVG), options))
    assert total == pytest.approx(signed_volume(stl), rel=1e-4)


def test_indexed_mesh_merges_identical_points() -> None:
    triangle = np.array(
        [[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[1, 0, 0], [1, 1, 0], [0, 1, 0]]], float
    )

    vertices, faces = indexed_mesh(triangle)

    assert len(vertices) == 4
    assert np.allclose(vertices[faces], triangle)


def test_honours_per_color_heights() -> None:
    model = _model(StlOptions(base_mm=0, layer_heights={0: 0}))

    names = [o.get("name") for o in model.iterfind("m:resources/m:object", NS)]
    assert names == ["color-1", "VectorSnap"]
