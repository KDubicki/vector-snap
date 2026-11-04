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
    assert "image/png" in body["supported_formats"]


def test_ready_reports_ready_with_the_load(client: TestClient) -> None:
    response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "version": __version__,
        "jobs": {"running": 0, "waiting": 0, "limit": 4},
    }
