import io
import json
import zipfile

import numpy as np
import pytest
from lxml import etree
from PIL import Image

from app.services.export_3mf import (
    CORE_NS,
    MODEL_PATH,
    MODEL_SETTINGS_PATH,
    PROJECT_SETTINGS_PATH,
    THUMBNAIL_PATH,
    ThreeMfOptions,
    export_3mf,
    indexed_mesh,
)
from app.services.export_stl import export_stl
from app.services.model_options import StlOptions
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg, read_binary_stl, signed_volume

FRAME = "M0,0 L20,0 L20,20 L0,20 Z M5,5 L5,15 L15,15 L15,5 Z"
DOT = "M30,0 L40,0 L40,10 L30,10 Z"
SVG = contract_svg(40, 20, [("#112233", [FRAME]), ("#ff0000", [DOT])])
NS = {"m": CORE_NS}


def _model(options: StlOptions, package_options: ThreeMfOptions | None = None) -> etree._Element:
    data = export_3mf(parse_svg(SVG), options, package_options)
    with zipfile.ZipFile(io.BytesIO(data)) as package:
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


def test_metadata_names_and_describes_the_model() -> None:
    package = ThreeMfOptions(title="Logo <v2>", designer="Ana & Bo", description="Coaster")

    model = _model(StlOptions(), package)

    metadata = {m.get("name"): m.text for m in model.iterfind("m:metadata", NS)}
    assert metadata.pop("Application").startswith("VectorSnap ")
    assert metadata == {"Title": "Logo <v2>", "Designer": "Ana & Bo", "Description": "Coaster"}
    assembly = model.find("m:resources/m:object/m:components", NS).getparent()
    assert assembly.get("name") == "Logo <v2>"


def test_empty_metadata_is_left_out() -> None:
    model = _model(StlOptions())

    assert [m.get("name") for m in model.iterfind("m:metadata", NS)] == ["Application"]


def test_objects_layout_makes_every_body_a_build_item() -> None:
    model = _model(StlOptions(base_mm=1), ThreeMfOptions(layout="objects"))

    objects = model.findall("m:resources/m:object", NS)
    assert [o.get("name") for o in objects] == ["base", "color-0", "color-1"]
    assert all(o.find("m:mesh", NS) is not None for o in objects)  # no assembly
    items = [item.get("objectid") for item in model.iterfind("m:build/m:item", NS)]
    assert items == [o.get("id") for o in objects]


def _slicer_files(
    package_options: ThreeMfOptions | None = None,
) -> tuple[etree._Element, etree._Element, dict[str, list[str]]]:
    data = export_3mf(parse_svg(SVG), StlOptions(base_mm=1), package_options)
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        model = etree.fromstring(package.read(MODEL_PATH))
        settings = etree.fromstring(package.read(MODEL_SETTINGS_PATH))
        return model, settings, json.loads(package.read(PROJECT_SETTINGS_PATH))


def _values(element: etree._Element) -> dict[str, str]:
    return {m.get("key"): m.get("value") for m in element.iterfind("metadata")}


def test_assigns_every_part_a_filament_in_its_color_for_orca_based_slicers() -> None:
    model, settings, project = _slicer_files(ThreeMfOptions(title="Sign"))

    # One filament per distinct color: the base plate shares the bottom color's slot.
    assert project == {"filament_colour": ["#112233", "#FF0000"]}
    (assembly,) = settings.iterfind("object")
    assert assembly.get("id") == model.find("m:build/m:item", NS).get("objectid")
    assert _values(assembly) == {"name": "Sign", "extruder": "1"}
    parts = assembly.findall("part")
    meshes = [
        o for o in model.iterfind("m:resources/m:object", NS) if o.find("m:mesh", NS) is not None
    ]
    assert [p.get("id") for p in parts] == [o.get("id") for o in meshes]
    assert [_values(p) for p in parts] == [
        {"name": "base", "extruder": "1"},
        {"name": "color-0", "extruder": "1"},
        {"name": "color-1", "extruder": "2"},
    ]


def test_objects_layout_assigns_a_filament_per_object() -> None:
    model, settings, _ = _slicer_files(ThreeMfOptions(layout="objects"))

    objects = settings.findall("object")
    assert [o.get("id") for o in objects] == [
        item.get("objectid") for item in model.iterfind("m:build/m:item", NS)
    ]
    assert [_values(o)["extruder"] for o in objects] == ["1", "1", "2"]
    assert [p.get("id") for o in objects for p in o.iterfind("part")] == [
        o.get("id") for o in objects
    ]


def test_slicer_config_can_be_left_out() -> None:
    data = export_3mf(parse_svg(SVG), StlOptions(), ThreeMfOptions(slicer_config=False))
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        assert not {MODEL_SETTINGS_PATH, PROJECT_SETTINGS_PATH} & set(package.namelist())


def _rgba(image: Image.Image, x: int, y: int) -> tuple[int, ...]:
    pixel = image.getpixel((x, y))
    assert isinstance(pixel, tuple)
    return pixel


def test_thumbnail_shows_the_colors_seen_from_above() -> None:
    data = export_3mf(parse_svg(SVG), StlOptions(width_mm=40, base_mm=1))
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        assert b"/Metadata/thumbnail.png" in package.read("_rels/.rels")
        assert b'Extension="png"' in package.read("[Content_Types].xml")
        image = Image.open(io.BytesIO(package.read(THUMBNAIL_PATH))).convert("RGBA")

    assert image.size == (256, 256)
    # 40 x 20 mm, centered (rows 69-187); the base plate follows the design's outline.
    assert _rgba(image, 5, 5)[3] == 0  # transparent around the model
    # Shaded by height: the frame's top (2 mm) is darker than the dot's (3 mm, the top).
    assert _rgba(image, 20, 128)[:3] == (14, 29, 43)  # frame, #112233 at 0.85
    assert _rgba(image, 68, 128)[3] == 0  # the frame's hole goes through the base
    assert _rgba(image, 216, 128 - 25)[:3] == (0xFF, 0x00, 0x00)  # dot, top right


def test_thumbnail_can_be_left_out() -> None:
    data = export_3mf(parse_svg(SVG), StlOptions(), ThreeMfOptions(thumbnail=False))
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        assert THUMBNAIL_PATH not in package.namelist()
        assert b"thumbnail" not in package.read("_rels/.rels")


def test_thumbnail_shows_an_engraving_in_the_plates_color() -> None:
    options = StlOptions(width_mm=40, base_mm=2, relief="engrave", layer_heights={0: 0, 1: 1})
    data = export_3mf(parse_svg(SVG), options)
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        image = Image.open(io.BytesIO(package.read(THUMBNAIL_PATH))).convert("RGBA")

    plate, engraved = _rgba(image, 20, 128), _rgba(image, 216, 128 - 25)
    assert plate[:3] == (0x11, 0x22, 0x33)
    assert engraved[:3] < plate[:3]  # 1 mm lower, darker
