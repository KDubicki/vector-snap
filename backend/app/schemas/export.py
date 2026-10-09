import json
import math

from pydantic import BaseModel, Field

from app.core.errors import InvalidParameters

MAX_LAYER_HEIGHT_MM = 100.0


def _parse_heights(raw: str, field_name: str) -> dict[str, float]:
    """Parse a JSON object of heights in mm sent as a multipart form field."""
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidParameters(f"`{field_name}` must be a JSON object.") from exc
    if not isinstance(values, dict):
        raise InvalidParameters(f"`{field_name}` must be a JSON object.")
    for key, value in values.items():
        if (
            isinstance(value, bool)
            or not isinstance(value, int | float)
            or not math.isfinite(value)
            or not 0 <= value <= MAX_LAYER_HEIGHT_MM
        ):
            raise InvalidParameters(
                f"`{field_name}` values must be between 0 and {MAX_LAYER_HEIGHT_MM:g} mm.",
                {"field": field_name, "key": key},
            )
    return {str(key): float(value) for key, value in values.items()}


def parse_layer_heights(raw: str) -> dict[int, float]:
    """Parse `{"<paletteIndex>": <mm>, ...}` sent as a multipart form field."""
    heights: dict[int, float] = {}
    for key, value in _parse_heights(raw, "layer_heights").items():
        try:
            heights[int(key)] = value
        except ValueError as exc:
            raise InvalidParameters(f"`layer_heights` key {key!r} is not a palette index.") from exc
    return heights


def parse_shape_heights(raw: str) -> dict[str, float]:
    """Parse `{"<shape id>": <mm>, ...}`: heights of single shapes (elements)."""
    return _parse_heights(raw, "shape_heights")


class FilamentStepModel(BaseModel):
    z_mm: float = Field(description="Height where this color starts")
    layer: int | None = Field(
        description="First printer layer in this color (1-based); null without print_layer_mm"
    )
    color: str


class FilamentConflictModel(BaseModel):
    z_mm: float = Field(description="Height where these colors all end")
    colors: list[str]


class FilamentPlanResponse(BaseModel):
    steps: list[FilamentStepModel] = Field(description="Starting filament, then each change")
    conflicts: list[FilamentConflictModel]
    height_mm: float
