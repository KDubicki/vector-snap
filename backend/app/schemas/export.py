import json
import math

from app.core.errors import InvalidParameters

MAX_LAYER_HEIGHT_MM = 100.0


def parse_layer_heights(raw: str) -> dict[int, float]:
    """Parse `{"<paletteIndex>": <mm>, ...}` sent as a multipart form field."""
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidParameters("`layer_heights` must be a JSON object.") from exc
    if not isinstance(values, dict):
        raise InvalidParameters("`layer_heights` must be a JSON object.")

    heights: dict[int, float] = {}
    for key, value in values.items():
        try:
            index = int(key)
        except ValueError as exc:
            raise InvalidParameters(f"`layer_heights` key {key!r} is not a palette index.") from exc
        if (
            isinstance(value, bool)
            or not isinstance(value, int | float)
            or not math.isfinite(value)
            or not 0 <= value <= MAX_LAYER_HEIGHT_MM
        ):
            raise InvalidParameters(
                f"`layer_heights` values must be between 0 and {MAX_LAYER_HEIGHT_MM:g} mm.",
                {"field": "layer_heights", "key": key},
            )
        heights[index] = float(value)
    return heights
