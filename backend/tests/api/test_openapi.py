from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.schemas.errors import ErrorResponse

ERROR_SCHEMA = {"$ref": "#/components/schemas/ErrorResponse"}


def _posts(client: TestClient) -> dict[str, dict[str, Any]]:
    spec = client.get("/openapi.json").json()
    return {path: ops["post"] for path, ops in spec["paths"].items() if "post" in ops}


def test_every_processing_endpoint_documents_the_error_envelope(client: TestClient) -> None:
    posts = _posts(client)

    assert len(posts) > 30
    for path, operation in posts.items():
        responses = operation["responses"]
        expected = {"400", "413", "422", "500", "503"}
        if not path.startswith("/api/v1/svg/"):
            expected.add("415")  # an image upload may be in a format not read
        errors = {status for status in responses if status != "200"}
        assert errors == expected, path
        for status in errors:
            assert responses[status]["content"]["application/json"]["schema"] == ERROR_SCHEMA


def test_the_framework_validation_schema_is_gone(client: TestClient) -> None:
    schemas = client.get("/openapi.json").json()["components"]["schemas"]

    assert "ErrorResponse" in schemas
    assert "HTTPValidationError" not in schemas


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/v1/quantize"),  # VALIDATION_ERROR
        ("POST", "/api/v1/svg/stats"),
        ("GET", "/api/v1/nowhere"),  # NOT_FOUND
        ("PUT", "/api/v1/health"),  # METHOD_NOT_ALLOWED
    ],
)
def test_errors_have_the_documented_shape(client: TestClient, method: str, path: str) -> None:
    response: httpx.Response = client.request(method, path)

    assert response.status_code >= 400
    error = ErrorResponse.model_validate(response.json(), strict=True)
    assert error.request_id == response.headers["X-Request-ID"]
