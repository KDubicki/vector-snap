import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.security import SECURITY_HEADERS


@pytest.mark.parametrize(
    ("method", "path", "status"),
    [
        ("GET", "/api/v1/health", 200),
        ("POST", "/api/v1/svg/stats", 422),  # an error, no svg sent
        ("GET", "/api/v1/nowhere", 404),
    ],
)
def test_api_responses_carry_the_security_headers(
    client: TestClient, method: str, path: str, status: int
) -> None:
    response = client.request(method, path)

    assert response.status_code == status
    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value


def test_svg_responses_cannot_run_or_be_framed(client: TestClient) -> None:
    response: httpx.Response = client.post(
        "/api/v1/export/sticker",
        files={
            "svg": (
                "doc.svg",
                b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
                b'<g id="color-0" data-palette-index="0" fill="#000000">'
                b'<path id="p-0-0" d="M0,0 h10 v10 h-10 z"/></g></svg>',
                "image/svg+xml",
            )
        },
    )

    assert response.headers["content-type"].startswith("image/svg+xml")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    policy = response.headers["Content-Security-Policy"]
    assert "default-src 'none'" in policy and "frame-ancestors 'none'" in policy


@pytest.mark.parametrize("path", ["/docs", "/openapi.json"])
def test_the_interactive_docs_are_left_alone(client: TestClient, path: str) -> None:
    response = client.get(path)

    assert response.status_code == 200
    assert "Content-Security-Policy" not in response.headers
