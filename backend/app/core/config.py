import re
from functools import lru_cache
from typing import Annotated, Literal, Self

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# A palette index is one byte and 255 marks transparent pixels (image_io.TRANSPARENT_LABEL),
# so a palette holds at most 255 colors.
MAX_PALETTE_COLORS = 255
# What a browser sends as `Origin`: scheme, host and an optional port, nothing after.
_ORIGIN_RE = re.compile(r"^https?://[^/\s?#]+$")


class Settings(BaseSettings):
    """The server's settings, from `VECTORSNAP_*` environment variables.

    Values it cannot run with stop the server at start, naming the setting, instead of
    failing requests later (a palette of 300 colors, an origin that never matches).
    """

    model_config = SettingsConfigDict(env_prefix="VECTORSNAP_", env_file=".env", extra="ignore")

    env: Literal["development", "production"] = "development"
    log_level: Literal["debug", "info", "warning", "error", "critical"] = "info"
    max_upload_mb: int = Field(10, ge=1)
    max_image_dimension: int = Field(4096, ge=1)
    min_colors: int = Field(2, ge=1, le=MAX_PALETTE_COLORS)
    max_colors: int = Field(64, ge=1, le=MAX_PALETTE_COLORS)
    # Shapes an uploaded SVG may hold: geometry work grows with them (a traced photo has a
    # few thousand).
    max_svg_shapes: int = Field(20_000, ge=1)
    # Processing (POST) requests one worker runs at once; more wait up to
    # `queue_timeout_s` for a slot, then get 503 SERVER_BUSY (app.core.concurrency).
    max_concurrent_jobs: int = Field(4, ge=1)
    queue_timeout_s: float = Field(30.0, ge=0)
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    @field_validator("log_level", mode="before")
    @classmethod
    def lower_level(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def check_origins(cls, origins: list[str]) -> list[str]:
        # A trailing slash, as copied from the address bar, would never match the
        # browser's `Origin` header: CORS would refuse the frontend without a word.
        origins = [origin if origin == "*" else origin.rstrip("/") for origin in origins]
        for origin in origins:
            if origin != "*" and not _ORIGIN_RE.match(origin):
                raise ValueError(
                    f"{origin!r} is not an origin: scheme, host and optional port, such as "
                    "https://vectorsnap.example.com or http://localhost:5173 (or *)."
                )
        return origins

    @model_validator(mode="after")
    def check_color_range(self) -> Self:
        if self.min_colors > self.max_colors:
            raise ValueError(
                f"min_colors ({self.min_colors}) is above max_colors ({self.max_colors})."
            )
        return self

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
