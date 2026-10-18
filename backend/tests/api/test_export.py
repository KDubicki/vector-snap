import io
import zipfile

import httpx
import pytest
from ezdxf.filemanagement import read as read_dxf
from fastapi.testclient import TestClient

from tests.images import encode, stripes
from tests.vectors import (
    contract_svg,
    is_balanced,
    is_closed,
    read_ascii_stl,
    read_binary_stl,
    signed_volume,
)

SVG = contract_svg(
    40, 20, [("#000000", ["M0,0 L20,0 L20,20 L0,20 Z"]), ("#ff0000", ["M30,0 h10 v10 h-10 z"])]
)


def _post(
    client: TestClient, fmt: str, form: dict[str, str] | None = None, data: bytes = SVG
) -> httpx.Response:
    response: httpx.Response = client.post(
        f"/api/v1/export/{fmt}", files={"svg": ("doc.svg", data, "image/svg+xml")}, data=form or {}
    )
    return response


def test_exports_stl(client: TestClient) -> None:
    response = _post(
        client, "stl", {"width_mm": "40", "base_mm": "0", "layer_mm": "2", "layered": "false"}
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "model/stl"
    assert 'filename="vectorsnap.stl"' in response.headers["content-disposition"]
    triangles = read_binary_stl(response.content)
    assert is_closed(triangles)
    assert signed_volume(triangles) == pytest.approx((400 + 100) * 2)


def test_stl_defaults(client: TestClient) -> None:
    triangles = read_binary_stl(_post(client, "stl").content)

    assert is_balanced(triangles)  # base plate + layers: closed bodies that touch
    assert signed_volume(triangles) > 0

    assert triangles[..., 0].max() == pytest.approx(100)  # default width 100 mm
    assert triangles[..., 2].max() == pytest.approx(3)  # base 1 + two layers of 1 mm


@pytest.mark.parametrize(
    ("form", "code"),
    [
        ({"width_mm": "0"}, "VALIDATION_ERROR"),
        ({"layer_mm": "-1"}, "VALIDATION_ERROR"),
        ({"min_feature_mm": "-0.1"}, "VALIDATION_ERROR"),
        ({"simplify_mm": "3"}, "VALIDATION_ERROR"),
        ({"color_gap_mm": "-0.1"}, "VALIDATION_ERROR"),
        ({"elephant_foot_mm": "0.6"}, "VALIDATION_ERROR"),
        ({"elephant_foot_mm": "0.2", "base_mm": "0"}, "INVALID_PARAMETERS"),
        ({"print_layer_mm": "2"}, "VALIDATION_ERROR"),
        ({"base_shape": "star"}, "VALIDATION_ERROR"),
        ({"base_margin_mm": "-1"}, "VALIDATION_ERROR"),
        ({"stack_order": "random"}, "VALIDATION_ERROR"),
        ({"relief": "engraved"}, "VALIDATION_ERROR"),
        ({"origin": "middle"}, "VALIDATION_ERROR"),
        ({"relief": "inlay"}, "INVALID_PARAMETERS"),  # base 1 mm, colors 1 and 2 mm deep
        ({"loop_hole_mm": "21"}, "VALIDATION_ERROR"),
        ({"loop_hole_mm": "4", "base_mm": "0"}, "INVALID_PARAMETERS"),
        ({"rim_mm": "-1"}, "VALIDATION_ERROR"),
        ({"rim_mm": "2", "base_mm": "0"}, "INVALID_PARAMETERS"),
        ({"magnet_mm": "51"}, "VALIDATION_ERROR"),
        ({"magnet_mm": "8", "magnet_depth_mm": "2"}, "INVALID_PARAMETERS"),  # base 1 mm
    ],
)
def test_rejects_invalid_options(client: TestClient, form: dict[str, str], code: str) -> None:
    response = _post(client, "stl", form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


def test_stl_rim(client: TestClient) -> None:
    form = {"width_mm": "40", "base_mm": "1", "layer_mm": "1", "rim_mm": "1", "rim_height_mm": "3"}

    triangles = read_binary_stl(_post(client, "stl", form).content)

    assert triangles[..., 2].max() == pytest.approx(4)


def test_stl_base_shape_and_margin(client: TestClient) -> None:
    form = {"width_mm": "40", "base_mm": "1", "base_shape": "rectangle", "base_margin_mm": "5"}

    triangles = read_binary_stl(_post(client, "stl", form).content)

    assert is_balanced(triangles)
    assert (triangles[..., 0].min(), triangles[..., 0].max()) == pytest.approx((-5, 45))
    assert (triangles[..., 1].min(), triangles[..., 1].max()) == pytest.approx((-5, 25))


def test_stl_magnet_pocket_keeps_every_part_closed(client: TestClient) -> None:
    form = {"width_mm": "40", "base_mm": "3", "magnet_mm": "10", "magnet_depth_mm": "2"}

    triangles = read_binary_stl(_post(client, "stl", form).content)

    assert is_balanced(triangles)
    assert triangles[..., 2].min() == 0
    assert (triangles[..., 2] == 2).any()  # the pocket ceiling


def test_stl_as_ascii(client: TestClient) -> None:
    form = {"width_mm": "40", "base_mm": "0", "layer_mm": "2", "layered": "false"}

    response = _post(client, "stl", {**form, "stl_format": "ascii"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "model/stl"
    triangles = read_ascii_stl(response.content)
    assert is_closed(triangles)
    assert signed_volume(triangles) == pytest.approx((400 + 100) * 2)


def test_stl_parts_as_ascii(client: TestClient) -> None:
    response = _post(client, "stl-parts", {"base_mm": "1", "stl_format": "ascii"})

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        stls = [name for name in archive.namelist() if name.endswith(".stl")]
        assert all(archive.read(name).startswith(b"solid vectorsnap") for name in stls)


def test_rejects_unknown_stl_format(client: TestClient) -> None:
    response = _post(client, "stl", {"stl_format": "obj"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_3mf_metadata(client: TestClient) -> None:
    response = _post(client, "3mf", {"title": "  Coaster ", "designer": "Ana"})

    with zipfile.ZipFile(io.BytesIO(response.content)) as package:
        model = package.read("3D/3dmodel.model").decode()
    assert '<metadata name="Title">Coaster</metadata>' in model
    assert '<metadata name="Designer">Ana</metadata>' in model
    assert "Description" not in model


def test_3mf_objects_layout(client: TestClient) -> None:
    response = _post(client, "3mf", {"layout": "objects"})

    with zipfile.ZipFile(io.BytesIO(response.content)) as package:
        model = package.read("3D/3dmodel.model").decode()
    assert "<components>" not in model
    assert model.count("<item ") == 3  # base and two colors


def test_3mf_assigns_filaments_for_slicers_unless_turned_off(client: TestClient) -> None:
    with zipfile.ZipFile(io.BytesIO(_post(client, "3mf", {}).content)) as package:
        assert "Metadata/model_settings.config" in package.namelist()
        assert "filament_colour" in package.read("Metadata/project_settings.config").decode()
    response = _post(client, "3mf", {"slicer_config": "false"})
    with zipfile.ZipFile(io.BytesIO(response.content)) as package:
        assert "Metadata/model_settings.config" not in package.namelist()


def test_3mf_rejects_unknown_layout(client: TestClient) -> None:
    response = _post(client, "3mf", {"layout": "grid"})

    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_3mf_rejects_too_long_metadata(client: TestClient) -> None:
    response = _post(client, "3mf", {"title": "x" * 201})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_rejects_invalid_svg(client: TestClient) -> None:
    response = _post(client, "stl", data=b"<svg")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_SVG"


def test_exports_dxf(client: TestClient) -> None:
    response = _post(client, "dxf", {"width_mm": "40", "fill": "true"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/vnd.dxf"
    assert 'filename="vectorsnap.dxf"' in response.headers["content-disposition"]
    drawing = read_dxf(io.StringIO(response.text))
    assert len(drawing.modelspace().query("LWPOLYLINE")) == 2
    assert len(drawing.modelspace().query("HATCH")) == 2


def test_dxf_rejects_invalid_svg(client: TestClient) -> None:
    response = _post(client, "dxf", data=b"<svg")

    assert response.json()["error"]["code"] == "INVALID_SVG"


def test_exports_pdf(client: TestClient) -> None:
    response = _post(client, "pdf", {"page": "a4", "margin_mm": "15"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert 'filename="vectorsnap.pdf"' in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF-")


def test_pdf_rejects_unknown_page_size(client: TestClient) -> None:
    response = _post(client, "pdf", {"page": "a3"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_stl_per_color_heights_and_mirror(client: TestClient) -> None:
    form = {
        "width_mm": "40",
        "base_mm": "0",
        "layer_heights": '{"0": 0, "1": 2.5}',
        "mirror": "true",
    }

    triangles = read_binary_stl(_post(client, "stl", form).content)

    # only the 10x10 square remains, 2.5 mm high, mirrored to the left edge
    assert signed_volume(triangles) == pytest.approx(100 * 2.5)
    assert triangles[..., 0].min() == pytest.approx(0)


@pytest.mark.parametrize(
    "heights",
    ["[1, 2]", '{"a": 1}', '{"0": -1}', '{"0": 101}', '{"0": true}', "nope"],
)
def test_stl_rejects_invalid_layer_heights(client: TestClient, heights: str) -> None:
    response = _post(client, "stl", {"layer_heights": heights})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_PARAMETERS"


@pytest.mark.parametrize("heights", ["[1]", '{"p-0-0": -1}', '{"p-0-0": "2"}', "nope"])
def test_stl_rejects_invalid_shape_heights(client: TestClient, heights: str) -> None:
    response = _post(client, "stl", {"shape_heights": heights})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_PARAMETERS"


def test_stl_parts_come_as_a_zip_of_stl_files(client: TestClient) -> None:
    response = _post(client, "stl-parts", {"base_mm": "1"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert 'filename="vectorsnap.zip"' in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
    assert names[0].startswith("01-base-") and names[-1] == "colors.txt"


def test_3mf_gives_raised_shapes_their_own_part(client: TestClient) -> None:
    response = _post(client, "3mf", {"shape_heights": '{"p-1-0": 3}'})

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as package:
        model = package.read("3D/3dmodel.model").decode()
    assert 'name="color-1-3mm"' in model
    assert 'name="color-1"' not in model  # its only shape is raised


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("filaments", '["red"]'),
        ("filaments", '{"0": "#ffffff"}'),
        ("filaments", "nope"),
        ("color_stacks", '{"0": {"top": []}}'),
        ("color_stacks", '{"0": {"base": -1}}'),
        ("color_stacks", '{"0": {"base": 0, "top": [[1, 0]]}}'),
        ("color_stacks", '{"0": {"base": 0, "top": [[true, 0.1]]}}'),
        ("color_stacks", '{"x": {"base": 0}}'),
        ("color_stacks", "[]"),
    ],
)
def test_stl_rejects_invalid_mixed_colors(client: TestClient, field: str, value: str) -> None:
    response = _post(client, "stl", {field: value})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_PARAMETERS"


def test_3mf_with_mixed_colors_has_one_part_per_filament_and_height(client: TestClient) -> None:
    stacks = '{"0": {"base": 0}, "1": {"base": 0, "top": [[1, 0.4]]}}'
    response = _post(
        client,
        "3mf",
        {"filaments": '["#FFFFFF", "#ff0000"]', "color_stacks": stacks, "layered": "false"},
    )

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as package:
        model = package.read("3D/3dmodel.model").decode()
    assert 'name="base"' in model
    assert 'name="filament-1-0-1mm"' in model
    assert 'name="filament-1-0-0.6mm"' in model
    assert 'name="filament-2-0.6-1mm"' in model
    assert 'displaycolor="#FF0000FF"' in model
    assert 'name="color-' not in model


def test_stl_with_every_color_left_out(client: TestClient) -> None:
    response = _post(client, "stl", {"layer_heights": '{"0": 0, "1": 0}'})

    assert response.status_code == 422
    assert "Nothing to export" in response.json()["error"]["message"]


def test_exports_3mf_with_the_stl_options(client: TestClient) -> None:
    response = _post(client, "3mf", {"base_mm": "0", "layer_heights": '{"0": 0}'})

    assert response.status_code == 200
    assert response.headers["content-type"] == "model/3mf"
    assert 'filename="vectorsnap.3mf"' in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as package:
        model = package.read("3D/3dmodel.model").decode()
    assert 'name="color-1"' in model
    assert 'name="color-0"' not in model


def test_3mf_validates_options_like_stl(client: TestClient) -> None:
    response = _post(client, "3mf", {"width_mm": "-5"})

    assert response.status_code == 422


def test_3mf_drops_details_thinner_than_min_feature(client: TestClient) -> None:
    svg = contract_svg(
        40, 20, [("#000000", ["M0,0 L20,0 L20,20 L0,20 Z"]), ("#ff0000", ["M30,0 h10 v0.2 h-10 z"])]
    )
    form = {"width_mm": "40", "min_feature_mm": "0.4"}

    with zipfile.ZipFile(io.BytesIO(_post(client, "3mf", form, data=svg).content)) as package:
        model = package.read("3D/3dmodel.model").decode()

    assert 'name="color-0"' in model
    assert 'name="color-1"' not in model


def test_filament_plan(client: TestClient) -> None:
    response = _post(client, "filament-plan", {"base_mm": "0.6", "print_layer_mm": "0.2"})

    assert response.status_code == 200
    assert response.json() == {
        "steps": [
            {"z_mm": 0.0, "layer": 1, "color": "#000000"},
            {"z_mm": 1.6, "layer": 9, "color": "#ff0000"},
        ],
        "conflicts": [],
        "height_mm": 2.6,
    }


def test_filament_plan_follows_the_stack_order(client: TestClient) -> None:
    response = _post(client, "filament-plan", {"base_mm": "0.6", "stack_order": "light_to_dark"})

    # red is lighter than black, so it is printed first (base) and black on top
    assert [step["color"] for step in response.json()["steps"]] == ["#ff0000", "#000000"]


def test_filament_plan_rejects_invalid_svg(client: TestClient) -> None:
    response = _post(client, "filament-plan", data=b"<svg")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_SVG"


def _post_image(client: TestClient, form: dict[str, str]) -> httpx.Response:
    response: httpx.Response = client.post(
        "/api/v1/export/lithophane",
        files={"image": ("photo.png", encode(stripes()), "image/png")},
        data=form,
    )
    return response


def test_exports_a_lithophane_from_the_image(client: TestClient) -> None:
    response = _post_image(client, {"width_mm": "50", "resolution_mm": "0.5", "frame_mm": "2"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "model/stl"
    triangles = read_binary_stl(response.content)
    assert is_closed(triangles)
    assert signed_volume(triangles) > 0
    size = triangles.reshape(-1, 3).max(axis=0) - triangles.reshape(-1, 3).min(axis=0)
    assert size[0] == pytest.approx(54)


@pytest.mark.parametrize(
    ("form", "field"),
    [
        ({"min_thickness_mm": "3", "max_thickness_mm": "2"}, "max_thickness_mm"),
        ({"width_mm": "1000", "resolution_mm": "0.05"}, "resolution_mm"),
    ],
)
def test_lithophane_rejects_invalid_options(
    client: TestClient, form: dict[str, str], field: str
) -> None:
    response = _post_image(client, form)

    assert response.status_code == 422
    assert response.json()["error"]["details"]["field"] == field


def test_exports_eps(client: TestClient) -> None:
    response = _post(client, "eps", {"width_mm": "40", "margin_mm": "2"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/postscript"
    assert 'filename="vectorsnap.eps"' in response.headers["content-disposition"]
    assert response.content.startswith(b"%!PS-Adobe-3.0 EPSF-3.0")


def test_eps_rejects_a_negative_margin(client: TestClient) -> None:
    response = _post(client, "eps", {"margin_mm": "-1"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
