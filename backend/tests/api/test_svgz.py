"""Gzip-compressed SVGs (.svgz, as Inkscape and Illustrator save them) wherever an SVG is
uploaded."""

import gzip

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app
from tests.vectors import contract_svg

SVG = contract_svg(
    20, 10, [("#000000", ["M0,0 H10 V10 H0 Z"]), ("#ff0000", ["M10,0 h10 v10 h-10 z"])]
)


def _post(client: TestClient, path: str, data: bytes) -> dict[str, object]:
    response = client.post(f"/api/v1/{path}", files={"svg": ("a.svgz", data, "image/svg+xml")})
    assert response.status_code == 200, response.text
    body: dict[str, object] = response.json()
    return body


@pytest.mark.parametrize("path", ["svg/stats", "svg/validate", "svg/import", "export/model-size"])
def test_an_svgz_reads_as_the_svg_it_holds(client: TestClient, path: str) -> None:
    assert _post(client, path, gzip.compress(SVG)) == _post(client, path, SVG)


def test_an_svgz_unpacking_past_the_upload_limit_is_refused() -> None:
    settings = Settings(max_upload_mb=1)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(app)
    # 2 MB of SVG in a few kilobytes of gzip.
    bomb = gzip.compress(SVG.replace(b"<svg ", b"<svg " + b" " * 2 * 2**20, 1))
    assert len(bomb) < 10_000

    response = client.post("/api/v1/svg/stats", files={"svg": ("a.svgz", bomb, "image/svg+xml")})

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "FILE_TOO_LARGE"


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"\x1f\x8b" + b"not gzip at all", "cannot be unpacked"),
        (gzip.compress(SVG)[:-30], "cut short"),
    ],
)
def test_a_broken_svgz_is_an_invalid_svg(client: TestClient, data: bytes, message: str) -> None:
    response = client.post("/api/v1/svg/stats", files={"svg": ("a.svgz", data, "image/svg+xml")})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "INVALID_SVG"
    assert message in error["message"]
