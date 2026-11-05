from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import create_app
from tests.vectors import contract_svg

SVG = contract_svg(10, 10, [("#000000", ["M0,0 h10 v10 h-10 z"])])


def test_an_unknown_path_is_answered_in_the_error_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/nowhere")

    assert response.status_code == 404
    body = response.json()
    assert body["error"] == {
        "code": "NOT_FOUND",
        "message": "No endpoint at /api/v1/nowhere.",
        "details": {"path": "/api/v1/nowhere"},
    }
    assert body["request_id"] == response.headers["X-Request-ID"]


def test_a_wrong_method_names_the_allowed_ones(client: TestClient) -> None:
    response = client.put("/api/v1/health")

    assert response.status_code == 405
    assert response.headers["Allow"] == "GET"
    error = response.json()["error"]
    assert error["code"] == "METHOD_NOT_ALLOWED"
    assert error["message"] == "PUT is not allowed here; use GET."
    assert error["details"] == {"allowed": ["GET"]}


def test_a_malformed_form_is_a_bad_request(client: TestClient) -> None:
    response = client.post(
        "/api/v1/svg/stats",
        files={"svg": ("doc.svg", SVG, "image/svg+xml")},
        data={f"field{i}": "x" for i in range(1001)},
    )

    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "BAD_REQUEST"
    assert "Too many fields" in error["message"]


def test_an_http_error_without_a_standard_status_keeps_its_message() -> None:
    app = create_app()

    @app.get("/api/v1/test/teapot")
    async def teapot() -> None:
        raise HTTPException(status_code=599, detail="Out of tea.")

    response = TestClient(app).get("/api/v1/test/teapot")

    assert response.status_code == 599
    assert response.json()["error"] == {
        "code": "HTTP_ERROR",
        "message": "Out of tea.",
        "details": {},
    }
