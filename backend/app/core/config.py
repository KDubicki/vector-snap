from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VECTORSNAP_", env_file=".env", extra="ignore")

    env: Literal["development", "production"] = "development"
    log_level: str = "info"
    max_upload_mb: int = 10
    max_image_dimension: int = 4096
    min_colors: int = 2
    max_colors: int = 64
    # Shapes an uploaded SVG may hold: geometry work grows with them (a traced photo has a
    # few thousand).
    max_svg_shapes: int = 20_000
    # Processing (POST) requests one worker runs at once; more wait up to
    # `queue_timeout_s` for a slot, then get 503 SERVER_BUSY (app.core.concurrency).
    max_concurrent_jobs: int = Field(4, ge=1)
    queue_timeout_s: float = Field(30.0, ge=0)
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
