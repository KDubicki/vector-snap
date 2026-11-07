from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _settings(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)


def test_the_defaults_are_valid() -> None:
    settings = _settings()

    assert (settings.min_colors, settings.max_colors) == (2, 64)
    assert settings.cors_origins == ["http://localhost:5173"]


def test_parses_comma_separated_cors_origins() -> None:
    settings = _settings(cors_origins="http://a.test, http://b.test:8080")

    assert settings.cors_origins == ["http://a.test", "http://b.test:8080"]


def test_drops_the_trailing_slash_of_an_origin() -> None:
    settings = _settings(cors_origins="https://vectorsnap.example.com/,*")

    assert settings.cors_origins == ["https://vectorsnap.example.com", "*"]


def test_reads_the_log_level_in_any_case() -> None:
    assert _settings(log_level=" WARNING ").log_level == "warning"


def test_a_palette_may_hold_up_to_255_colors() -> None:
    settings = _settings(min_colors=1, max_colors=255)

    assert (settings.min_colors, settings.max_colors) == (1, 255)


@pytest.mark.parametrize(
    ("values", "field"),
    [
        ({"max_colors": 256}, "max_colors"),
        ({"min_colors": 0}, "min_colors"),
        ({"max_upload_mb": 0}, "max_upload_mb"),
        ({"max_image_dimension": 0}, "max_image_dimension"),
        ({"max_svg_shapes": 0}, "max_svg_shapes"),
        ({"log_level": "verbose"}, "log_level"),
        ({"cors_origins": "localhost:5173"}, "cors_origins"),
        ({"cors_origins": "https://example.com/app"}, "cors_origins"),
    ],
)
def test_refuses_values_the_server_cannot_run_with(values: dict[str, Any], field: str) -> None:
    with pytest.raises(ValidationError) as error:
        _settings(**values)

    assert error.value.errors()[0]["loc"] == (field,)


def test_refuses_a_color_range_upside_down() -> None:
    with pytest.raises(ValidationError, match=r"min_colors \(10\) is above max_colors \(5\)"):
        _settings(min_colors=10, max_colors=5)


def test_reads_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VECTORSNAP_MAX_COLORS", "300")

    with pytest.raises(ValidationError, match="max_colors"):
        _settings()
