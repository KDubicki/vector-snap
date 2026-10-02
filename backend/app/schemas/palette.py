from pydantic import BaseModel, Field

HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


class PaletteColor(BaseModel):
    index: int = Field(ge=0)
    hex: str = Field(pattern=HEX_COLOR_PATTERN)
    rgb: tuple[int, int, int] | None = None
    coverage: float | None = Field(default=None, ge=0, le=1)
