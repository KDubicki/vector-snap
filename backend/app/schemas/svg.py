import json
import re

from pydantic import BaseModel, Field

from app.core.errors import InvalidParameters
from app.schemas.palette import HEX_COLOR_PATTERN

_HEX_COLOR_RE = re.compile(HEX_COLOR_PATTERN)


class ColorChangeModel(BaseModel):
    color: str = Field(pattern=HEX_COLOR_PATTERN)
    into: str = Field(pattern=HEX_COLOR_PATTERN)
    delta_e: float = Field(ge=0, description="CIEDE2000 difference between the two")


class SvgEditResponse(BaseModel):
    svg: str
    colors: int = Field(ge=0, description="Color layers of the edited SVG")
    changes: list[ColorChangeModel]


def parse_color_map(raw: str, field: str) -> dict[str, str]:
    """Parse a JSON object of `#rrggbb` colors to `#rrggbb` colors (a multipart field)."""
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidParameters(f"`{field}` must be a JSON object.", {"field": field}) from exc
    if not isinstance(values, dict) or not all(
        isinstance(value, str) and _HEX_COLOR_RE.match(key) and _HEX_COLOR_RE.match(value)
        for key, value in values.items()
    ):
        raise InvalidParameters(
            f'`{field}` must map hex colors to hex colors, like {{"#fefefe": "#ffffff"}}.',
            {"field": field},
        )
    return {key.lower(): value.lower() for key, value in values.items()}
