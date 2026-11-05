from collections.abc import AsyncIterator

import pytest
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.core.errors import INTERNAL_ERROR_MESSAGE
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


def _crashing_app() -> TestClient:
    app = create_app()

    @app.post("/api/v1/test/crash")
    async def crash() -> None:
        raise RuntimeError("secret internals")

    @app.post("/api/v1/test/crash-in-thread")
    def crash_in_thread() -> None:
        raise ValueError("secret internals")

    return TestClient(app)


@pytest.mark.parametrize("path", ["/api/v1/test/crash", "/api/v1/test/crash-in-thread"])
def test_an_unexpected_error_is_answered_in_the_error_envelope(
    path: str, caplog: pytest.LogCaptureFixture
) -> None:
    response = _crashing_app().post(path, headers={"Origin": "http://localhost:5173"})

    assert response.status_code == 500
    body = response.json()
    assert body["error"] == {
        "code": "INTERNAL_ERROR",
        "message": INTERNAL_ERROR_MESSAGE,
        "details": {},
    }
    assert body["request_id"] == response.headers["X-Request-ID"]
    # A browser can read it, and it gives nothing away.
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "secret" not in response.text
    # The traceback is in the log, under the request id.
    [record] = [r for r in caplog.records if r.name == "app.errors"]
    assert record.exc_info is not None
    assert getattr(record, "request_id", body["request_id"]) == body["request_id"]


def test_an_error_after_the_answer_started_is_left_to_the_server() -> None:
    app = create_app()

    @app.get("/api/v1/test/broken-stream")
    async def broken_stream() -> StreamingResponse:
        async def parts() -> AsyncIterator[bytes]:
            yield b"partial"
            raise RuntimeError("cut off")

        return StreamingResponse(parts())

    # Nothing can replace a response already sent: the error reaches the server.
    with TestClient(app) as client, pytest.raises(RuntimeError, match="cut off"):
        client.get("/api/v1/test/broken-stream")
