import httpx
import pytest
from fastapi.testclient import TestClient

from tests.vectors import contract_svg

# 50 squares: an export or edit of it is well over the gzip threshold.
SVG = contract_svg(
    500,
    50,
    [
        ("#000000", [f"M{x * 10},0 h8 v8 h-8 z" for x in range(25)]),
        ("#ff0000", [f"M{x * 10},20 h8 v8 h-8 z" for x in range(25)]),
    ],
)


def _post(client: TestClient, path: str, encoding: str = "gzip") -> httpx.Response:
    response: httpx.Response = client.post(
        path,
        files={"svg": ("doc.svg", SVG, "image/svg+xml")},
        data={"dx": "1"},
        headers={"Accept-Encoding": encoding},
    )
    return response


@pytest.mark.parametrize("path", ["/api/v1/svg/transform", "/api/v1/export/stl"])
def test_large_responses_are_gzipped(client: TestClient, path: str) -> None:
    compressed = _post(client, path)
    plain = _post(client, path, encoding="identity")

    assert compressed.status_code == plain.status_code == 200
    assert compressed.headers["content-encoding"] == "gzip"
    assert "accept-encoding" in compressed.headers["vary"].lower()
    assert int(compressed.headers["content-length"]) < len(plain.content) / 2
    # httpx decodes it: the same response as without gzip.
    assert compressed.content == plain.content
    assert "content-encoding" not in plain.headers


@pytest.mark.parametrize(("fmt", "media_type"), [("3mf", "model/3mf"), ("png", "image/png")])
def test_compressed_formats_are_sent_as_they_are(
    client: TestClient, fmt: str, media_type: str
) -> None:
    response = _post(client, f"/api/v1/export/{fmt}")

    assert response.headers["content-type"] == media_type
    assert len(response.content) > 1024
    assert "content-encoding" not in response.headers


def test_small_responses_are_sent_as_they_are(client: TestClient) -> None:
    response = client.get("/api/v1/limits", headers={"Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert "content-encoding" not in response.headers
