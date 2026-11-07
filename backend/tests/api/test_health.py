import warnings

import pytest
from fastapi.testclient import TestClient

from app import __version__


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}
    assert "X-Request-ID" in response.headers


def test_request_id_is_echoed(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"X-Request-ID": "abc-123"})

    assert response.headers["X-Request-ID"] == "abc-123"


def test_limits_exposes_configuration(client: TestClient) -> None:
    body = client.get("/api/v1/limits").json()

    assert body["min_colors"] < body["max_colors"]
    assert body["max_svg_shapes"] == 20_000
    assert body["supported_formats"] == [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/avif",
        "image/gif",
        "image/bmp",
        "image/tiff",
    ]


def test_ready_reports_ready_with_the_load(client: TestClient) -> None:
    response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "version": __version__,
        "jobs": {"running": 0, "waiting": 0, "limit": 4},
    }


@pytest.mark.parametrize("path", ["/api/v1/health", "/api/v1/health/ready", "/api/v1/limits"])
def test_answers_head_probes(client: TestClient, path: str) -> None:
    response = client.head(path)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.content == b""


def test_processing_endpoints_still_refuse_head(client: TestClient) -> None:
    response = client.head("/api/v1/quantize")

    assert response.status_code == 405
    assert response.headers["allow"] == "POST"


def test_the_schema_lists_head_probes_once_as_get(client: TestClient) -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # FastAPI warns of duplicate operation ids
        paths = client.get("/openapi.json").json()["paths"]

    assert set(paths["/api/v1/health"]) == {"get"}
