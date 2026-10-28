import json
import math
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


class SvgSplitResponse(BaseModel):
    svg: str
    split: int = Field(ge=0, description="Shapes the line split")
    created: list[str] = Field(description="Ids of the pieces, in document order")


# A knife line drawn in the editor has a few hundred points.
MAX_LINE_POINTS = 10_000
MAX_SHAPE_IDS = 10_000


def parse_line(raw: str, field: str) -> list[tuple[float, float]]:
    """Parse a JSON polyline `[[x, y], ...]` of at least two points (a multipart field)."""
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidParameters(f"`{field}` must be a JSON array.", {"field": field}) from exc
    if (
        not isinstance(values, list)
        or not 2 <= len(values) <= MAX_LINE_POINTS
        or not all(
            isinstance(point, list)
            and len(point) == 2
            and all(
                isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v)
                for v in point
            )
            for point in values
        )
    ):
        raise InvalidParameters(
            f"`{field}` must be 2 to {MAX_LINE_POINTS} points like [[0, 5], [40, 5]].",
            {"field": field},
        )
    points = [(float(x), float(y)) for x, y in values]
    if len(set(points)) < 2:
        raise InvalidParameters(f"`{field}` needs two different points.", {"field": field})
    return points


def parse_shape_ids(raw: str, field: str) -> list[str]:
    """Parse a JSON array of shape ids (a multipart field)."""
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidParameters(f"`{field}` must be a JSON array.", {"field": field}) from exc
    if (
        not isinstance(values, list)
        or len(values) > MAX_SHAPE_IDS
        or not all(isinstance(value, str) and value for value in values)
    ):
        raise InvalidParameters(
            f'`{field}` must be a JSON array of shape ids like ["p-1-0"].', {"field": field}
        )
    return values
