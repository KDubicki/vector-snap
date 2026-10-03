from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app


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
