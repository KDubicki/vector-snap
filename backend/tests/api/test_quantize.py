import base64
import io
import json

import httpx
import numpy as np
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


def _speckled() -> Image.Image:
    """Red and blue halves sprinkled with single pixels of the other color."""
    rng = np.random.default_rng(0)
    pixels = np.zeros((40, 40, 3), dtype=np.uint8)
    pixels[:, :20] = (220, 0, 0)
    pixels[:, 20:] = (0, 0, 220)
    specks = rng.random((40, 40)) < 0.05
    pixels[specks] = 220 - pixels[specks]
    return Image.fromarray(pixels, mode="RGB")


def test_quantize_smooths_noisy_regions(client: TestClient) -> None:
    rough = _post(client, encode(_speckled()), colors="2")
    smooth = _post(client, encode(_speckled()), colors="2", smooth="1")

    assert smooth.status_code == 200

    def edges(response: httpx.Response) -> int:
        png = Image.open(io.BytesIO(base64.b64decode(response.json()["image"]["data"])))
        labels = np.asarray(png)
        return int((labels[:, 1:] != labels[:, :-1]).sum() + (labels[1:] != labels[:-1]).sum())

    assert edges(smooth) < edges(rough) / 3


def test_quantize_merges_colors_under_the_minimum_coverage(client: TestClient) -> None:
    # Red 60 %, green 30 %, a darker red 10 %: under 15 %, it joins the red.
    image = stripes(colors=((255, 0, 0), (0, 160, 0), (200, 0, 0)))
    response = _post(client, encode(image), colors="3", min_coverage="0.15")

    assert response.status_code == 200
    body = response.json()
    assert [color["hex"] for color in body["palette"]] == ["#ff0000", "#00a000"]
    assert body["merged"] == [{"hex": "#c80000", "into": "#ff0000", "coverage": 0.1}]


def test_quantize_merges_nothing_by_default(client: TestClient) -> None:
    body = _post(client, encode(stripes()), colors="3").json()

    assert len(body["palette"]) == 3
    assert body["merged"] == []


def test_quantize_rejects_a_minimum_coverage_over_half(client: TestClient) -> None:
    assert _post(client, encode(stripes()), colors="3", min_coverage="0.6").status_code == 422


def test_quantize_upscales_small_images(client: TestClient) -> None:
    response = _post(client, encode(stripes()), colors="3", upscale="true")

    assert response.status_code == 200
    body = response.json()
    assert (body["width"], body["height"]) == (40, 16)
    png = Image.open(io.BytesIO(base64.b64decode(body["image"]["data"])))
    assert png.size == (40, 16)


@pytest.mark.parametrize("smooth", ["-1", "4"])
def test_quantize_rejects_invalid_smoothing(client: TestClient, smooth: str) -> None:
    response = _post(client, encode(noisy()), colors="4", smooth=smooth)

    assert response.status_code == 422


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


def test_suggest_colors_returns_a_count_and_error_curve(client: TestClient) -> None:
    response = client.post(
        "/api/v1/suggest-colors", files={"image": ("image.png", encode(noisy()), "image/png")}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["colors"] == 4
    assert body["target_delta_e"] == 5.0
    assert [e["colors"] for e in body["errors"]] == [2, 3, 4]
    assert body["errors"][-1]["mean_delta_e"] <= 5.0


def test_suggest_colors_rejects_unsupported_files(client: TestClient) -> None:
    response = client.post(
        "/api/v1/suggest-colors", files={"image": ("image.gif", b"GIF89a....", "image/gif")}
    )

    assert response.status_code == 415


def test_quantize_suggests_the_border_color_as_background(client: TestClient) -> None:
    flat = _post(client, encode(stripes()), colors="4").json()
    blocks = _post(client, encode(noisy()), colors="4").json()

    assert flat["background_index"] == 0  # red covers most of the border
    assert blocks["background_index"] is None  # four colors share the border equally


def test_quantize_to_filaments_uses_their_exact_colors(client: TestClient) -> None:
    filaments = '["#c81e1e", "#148c28", "#0a1ec8", "#ffffff", "#000000"]'

    response = _post(
        client, encode(stripes()), colors="4", algorithm="filaments", filaments=filaments
    )

    assert response.status_code == 200
    assert [c["hex"] for c in response.json()["palette"]] == ["#c81e1e", "#148c28", "#0a1ec8"]


@pytest.mark.parametrize(
    "form",
    [
        {"algorithm": "filaments"},
        {"algorithm": "filaments", "filaments": '["red"]'},
        {"algorithm": "filaments", "filaments": json.dumps([f"#{i:06x}" for i in range(129)])},
    ],
)
def test_quantize_to_filaments_needs_valid_filaments(
    client: TestClient, form: dict[str, str]
) -> None:
    response = _post(client, encode(stripes()), colors="4", **form)

    assert response.status_code == 422
