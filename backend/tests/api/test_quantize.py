import base64
import io

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from tests.images import encode, noisy, stripes, with_transparent_corner


def _post(client: TestClient, data: bytes, **form: str) -> httpx.Response:
    response: httpx.Response = client.post(
        "/api/v1/quantize", files={"image": ("image.png", data, "image/png")}, data=form
    )
    return response


def test_quantize_returns_palette_and_indexed_png(client: TestClient) -> None:
    response = _post(client, encode(with_transparent_corner(stripes())), colors="4")

    assert response.status_code == 200
    body = response.json()
    assert (body["width"], body["height"]) == (10, 4)
    assert body["has_transparency"] is True
    assert [c["hex"] for c in body["palette"]] == ["#ff0000", "#00a000", "#0000ff"]
    assert body["palette"][0]["rgb"] == [255, 0, 0]
    assert sum(c["coverage"] for c in body["palette"]) == pytest.approx(1.0, abs=0.001)

    png = Image.open(io.BytesIO(base64.b64decode(body["image"]["data"])))
    assert png.mode == "P"
    assert png.info["transparency"] == 3


def test_quantize_supports_median_cut(client: TestClient) -> None:
    response = _post(client, encode(noisy()), colors="4", algorithm="median_cut")

    assert response.status_code == 200
    assert len(response.json()["palette"]) <= 4


@pytest.mark.parametrize("algorithm", ["kmeans", "median_cut"])
def test_quantize_keeps_locked_colors(client: TestClient, algorithm: str) -> None:
    response = _post(
        client,
        encode(noisy()),
        colors="4",
        algorithm=algorithm,
        locked_colors='["#123456"]',
    )

    assert response.status_code == 200
    assert "#123456" in [c["hex"] for c in response.json()["palette"]]


@pytest.mark.parametrize("colors", ["1", "65"])
def test_quantize_rejects_color_count_out_of_range(client: TestClient, colors: str) -> None:
    response = _post(client, encode(stripes()), colors=colors)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_PARAMETERS"


def test_quantize_requires_colors(client: TestClient) -> None:
    response = _post(client, encode(stripes()))

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"]["errors"][0]["loc"] == ["body", "colors"]


@pytest.mark.parametrize("locked", ["not json", '["red"]', '{"a": 1}'])
def test_quantize_rejects_invalid_locked_colors(client: TestClient, locked: str) -> None:
    response = _post(client, encode(stripes()), colors="4", locked_colors=locked)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_PARAMETERS"


def test_quantize_rejects_unsupported_files(client: TestClient) -> None:
    response = _post(client, b"GIF89a....", colors="4")

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"
