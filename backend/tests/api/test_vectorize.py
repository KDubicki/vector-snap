import base64

import httpx
import pytest
from fastapi.testclient import TestClient
from lxml import etree

from app.services.svg_postprocess import SVG_NS
from tests.images import encode, noisy, stripes, with_transparent_corner


def _post(
    client: TestClient,
    data: bytes,
    form: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    response: httpx.Response = client.post(
        "/api/v1/vectorize",
        files={"image": ("image.png", data, "image/png")},
        data=form or {},
        headers=headers,
    )
    return response


def _quantized_png(client: TestClient) -> bytes:
    body = client.post(
        "/api/v1/quantize",
        files={
            "image": ("a.png", encode(with_transparent_corner(stripes(height=12))), "image/png")
        },
        data={"colors": "4"},
    ).json()
    return base64.b64decode(body["image"]["data"])


def _fills(svg: str) -> list[str | None]:
    root = etree.fromstring(svg.encode())
    return [g.get("fill") for g in root.iter(f"{{{SVG_NS}}}g")]


def test_vectorizes_indexed_png_from_quantize(client: TestClient) -> None:
    response = _post(client, _quantized_png(client), {"mode": "polygon", "filter_speckle": "0"})

    assert response.status_code == 200
    body = response.json()
    assert (body["width"], body["height"]) == (10, 12)
    assert _fills(body["svg"]) == ["#ff0000", "#00a000", "#0000ff"]
    assert body["stats"]["paths"] == 3
    assert body["stats"]["bytes"] == len(body["svg"].encode())
    assert [c["hex"] for c in body["palette"]] == ["#ff0000", "#00a000", "#0000ff"]


def test_applies_palette_overrides(client: TestClient) -> None:
    response = _post(
        client, _quantized_png(client), {"palette": '["#111111", "#222222", "#333333"]'}
    )

    assert response.status_code == 200
    assert _fills(response.json()["svg"]) == ["#111111", "#222222", "#333333"]


def test_rejects_palette_of_wrong_length(client: TestClient) -> None:
    response = _post(client, _quantized_png(client), {"palette": '["#111111"]'})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "INVALID_PARAMETERS"
    assert error["details"]["expected"] == 3


def test_requires_colors_for_non_indexed_images(client: TestClient) -> None:
    response = _post(client, encode(stripes()))

    assert response.status_code == 422
    assert response.json()["error"]["details"]["field"] == "colors"


def test_one_shot_mode_quantizes_first(client: TestClient) -> None:
    response = _post(client, encode(noisy()), {"colors": "4"})

    assert response.status_code == 200
    assert len(response.json()["palette"]) == 4


def test_returns_raw_svg_when_requested(client: TestClient) -> None:
    response = _post(client, encode(noisy()), {"colors": "4"}, headers={"Accept": "image/svg+xml"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert response.text.startswith("<svg")


@pytest.mark.parametrize(
    "form",
    [
        {"colors": "100"},
        {"colors": "4", "palette": "nope"},
        {"colors": "4", "mode": "bezier"},
        {"colors": "4", "transparent": "not json"},
        {"colors": "4", "transparent": "[-1]"},
        {"colors": "4", "transparent": '["0"]'},
        {"colors": "4", "transparent": "[true]"},
        {"colors": "4", "transparent": "[9]"},
        {"colors": "4", "transparent": "[0, 1, 2, 3]"},
    ],
)
def test_rejects_invalid_parameters(client: TestClient, form: dict[str, str]) -> None:
    response = _post(client, encode(noisy()), form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] in {"INVALID_PARAMETERS", "VALIDATION_ERROR"}


def test_leaves_transparent_colors_out(client: TestClient) -> None:
    form = {"palette": '["#ff0000", "#00a000", "#0000ff"]', "transparent": "[0]"}

    response = _post(client, _quantized_png(client), form)

    assert response.status_code == 200
    body = response.json()
    assert _fills(body["svg"]) == ["#00a000", "#0000ff"]
    # The palette keeps every entry so indices stay stable; the removed one covers nothing.
    assert [c["hex"] for c in body["palette"]] == ["#ff0000", "#00a000", "#0000ff"]
    assert body["palette"][0]["coverage"] == 0
