import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app


@pytest.mark.parametrize(
    ("path", "form"),
    [
        ("/api/v1/quantize", {"colors": "4"}),
        ("/api/v1/vectorize", {}),
    ],
)
def test_processing_endpoints_return_error_envelope(
    client: TestClient, path: str, form: dict[str, str]
) -> None:
    response = client.post(path, files={"image": ("a.png", b"data", "image/png")}, data=form)

    assert response.status_code == 501
    body = response.json()
    assert body["error"]["code"] == "NOT_IMPLEMENTED"
    assert body["request_id"] == response.headers["X-Request-ID"]


def test_upload_over_limit_is_rejected() -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(max_upload_mb=0)
    client = TestClient(app)

    response = client.post(
        "/api/v1/quantize",
        files={"image": ("a.png", b"x", "image/png")},
        data={"colors": "4"},
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "FILE_TOO_LARGE"


def test_settings_parse_comma_separated_cors_origins() -> None:
    settings = Settings(cors_origins="http://a.test, http://b.test")

    assert settings.cors_origins == ["http://a.test", "http://b.test"]
