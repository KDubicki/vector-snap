import json
import math
import re
from typing import Any

from pydantic import BaseModel, Field

from app.core.errors import InvalidParameters
from app.services.export_stl import ColorStack

MAX_LAYER_HEIGHT_MM = 100.0
MAX_FILAMENTS = 16
MAX_STACK_LAYERS = 8
_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


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


_TRUE = {"true", "1", "yes", "on"}
_FALSE = {"false", "0", "no", "off"}


def parse_flag(raw: str | None, field_name: str, default: bool) -> bool:
    """A true/false form field whose default is `true`.

    FastAPI 0.149 reads a missing `bool` form field as an unchecked HTML checkbox, i.e.
    false, whatever its default; such fields are taken as text and parsed here instead,
    so leaving them out keeps the default.
    """
    if raw is None or raw == "":
        return default
    value = raw.strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise InvalidParameters(f"`{field_name}` must be true or false.", {"field": field_name})


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


def _json(raw: str, field_name: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidParameters(f"`{field_name}` must be valid JSON.") from exc


def parse_filaments(raw: str) -> tuple[str, ...]:
    """Parse `["#rrggbb", ...]`: the loaded filaments for mixed colors."""
    values = _json(raw, "filaments")
    if (
        not isinstance(values, list)
        or len(values) > MAX_FILAMENTS
        or not all(isinstance(value, str) and _HEX_COLOR.match(value) for value in values)
    ):
        raise InvalidParameters(
            f'`filaments` must be a list of up to {MAX_FILAMENTS} colors like "#ff0000".',
            {"field": "filaments"},
        )
    return tuple(value.lower() for value in values)


def _is_index(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _is_thickness(value: object) -> bool:
    return (
        isinstance(value, int | float)
        and not isinstance(value, bool)
        and math.isfinite(value)
        and 0 < value <= MAX_LAYER_HEIGHT_MM
    )


def parse_color_stacks(raw: str) -> dict[int, ColorStack]:
    """Parse `{"<paletteIndex>": {"base": 0, "top": [[2, 0.16], ...]}, ...}`."""
    values = _json(raw, "color_stacks")
    if not isinstance(values, dict):
        raise InvalidParameters("`color_stacks` must be a JSON object.")
    stacks: dict[int, ColorStack] = {}
    for key, value in values.items():
        top = value.get("top", []) if isinstance(value, dict) else None
        if (
            not key.isdigit()
            or not isinstance(value, dict)
            or not _is_index(value.get("base"))
            or not isinstance(top, list)
            or len(top) > MAX_STACK_LAYERS
            or not all(
                isinstance(layer, list)
                and len(layer) == 2
                and _is_index(layer[0])
                and _is_thickness(layer[1])
                for layer in top
            )
        ):
            raise InvalidParameters(
                '`color_stacks` entries must look like {"base": 0, "top": [[1, 0.16]]} '
                f"with up to {MAX_STACK_LAYERS} top layers.",
                {"field": "color_stacks", "key": key},
            )
        stacks[int(key)] = ColorStack(
            base=value["base"], top=tuple((f, float(mm)) for f, mm in top)
        )
    return stacks


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


class FilamentUseModel(BaseModel):
    color: str
    volume_mm3: float = Field(description="Solid volume; the slicer's infill uses less")
    grams: float = Field(description="volume_mm3 at density_g_cm3")


class ColorChangesResponse(BaseModel):
    filaments: list[FilamentUseModel] = Field(
        description="Filament per distinct color, in 3MF filament (slot) order"
    )
    layers: int = Field(description="Printer layers of the model")
    changes: int = Field(description="Filament changes, not counting the first load")
    max_colors_per_layer: int
    change_time_s: float = Field(description="changes * change_s")
    purge_mm3: float = Field(description="changes * purge_mm3")
    purge_g: float = Field(description="Purged filament at density_g_cm3")


class ModelSizeResponse(BaseModel):
    x_mm: float = Field(description="Width of the model, base plate and loop included")
    y_mm: float = Field(description="Depth of the model")
    z_mm: float = Field(description="Height of the model")
