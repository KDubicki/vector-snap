from pydantic import BaseModel, Field

from app.schemas.palette import HEX_COLOR_PATTERN


class ColorChangeModel(BaseModel):
    color: str = Field(pattern=HEX_COLOR_PATTERN)
    into: str = Field(pattern=HEX_COLOR_PATTERN)
    delta_e: float = Field(ge=0, description="CIEDE2000 difference between the two")


class SvgEditResponse(BaseModel):
    svg: str
    colors: int = Field(ge=0, description="Color layers of the edited SVG")
    changes: list[ColorChangeModel]
