from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app
from tests.vectors import contract_svg


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


def test_svg_with_too_many_shapes_is_rejected() -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(max_svg_shapes=2)
    client = TestClient(app)
    svg = contract_svg(10, 10, [("#000000", ["M0,0 h1 v1 z", "M2,2 h1 v1 z", "M4,4 h1 v1 z"])])

    response = client.post("/api/v1/svg/stats", files={"svg": ("a.svg", svg, "image/svg+xml")})
    assert response.status_code == 413
    error = response.json()["error"]
    assert error["code"] == "SVG_TOO_COMPLEX"
    assert error["details"] == {"shapes": 3, "max_svg_shapes": 2}

    check = client.post("/api/v1/svg/validate", files={"svg": ("a.svg", svg, "image/svg+xml")})
    assert check.status_code == 200
    assert check.json()["valid"] is False
    assert check.json()["problems"][0]["code"] == "too_many_shapes"
