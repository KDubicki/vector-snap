import io
import zipfile

import httpx
import pytest
from ezdxf.filemanagement import read as read_dxf
from fastapi.testclient import TestClient

from tests.vectors import contract_svg, is_balanced, is_closed, read_binary_stl, signed_volume

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
        ({"print_layer_mm": "2"}, "VALIDATION_ERROR"),
        ({"base_shape": "star"}, "VALIDATION_ERROR"),
        ({"base_margin_mm": "-1"}, "VALIDATION_ERROR"),
    ],
)
def test_rejects_invalid_options(client: TestClient, form: dict[str, str], code: str) -> None:
    response = _post(client, "stl", form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


def test_stl_base_shape_and_margin(client: TestClient) -> None:
    form = {"width_mm": "40", "base_mm": "1", "base_shape": "rectangle", "base_margin_mm": "5"}

    triangles = read_binary_stl(_post(client, "stl", form).content)

    assert is_balanced(triangles)
    assert (triangles[..., 0].min(), triangles[..., 0].max()) == pytest.approx((-5, 45))
    assert (triangles[..., 1].min(), triangles[..., 1].max()) == pytest.approx((-5, 25))


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


def test_filament_plan_rejects_invalid_svg(client: TestClient) -> None:
    response = _post(client, "filament-plan", data=b"<svg")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_SVG"
