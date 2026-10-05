import io

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
    [({"width_mm": "0"}, "VALIDATION_ERROR"), ({"layer_mm": "-1"}, "VALIDATION_ERROR")],
)
def test_rejects_invalid_options(client: TestClient, form: dict[str, str], code: str) -> None:
    response = _post(client, "stl", form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


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
