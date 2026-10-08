import json
import re

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, Field

from app.core.errors import InvalidParameters

HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"
_HEX_COLOR_RE = re.compile(HEX_COLOR_PATTERN)


class PaletteColor(BaseModel):
    index: int = Field(ge=0)
    hex: str = Field(pattern=HEX_COLOR_PATTERN)
    rgb: tuple[int, int, int] | None = None
    coverage: float | None = Field(default=None, ge=0, le=1)


def palette_colors(palette: NDArray[np.uint8], coverage: NDArray[np.float64]) -> list[PaletteColor]:
    """Response entries for a palette (N x 3 sRGB) and its coverage fractions."""
    entries = []
    for index, color in enumerate(palette):
        rgb = (int(color[0]), int(color[1]), int(color[2]))
        entries.append(
            PaletteColor(
                index=index,
                hex=rgb_to_hex(rgb),
                rgb=rgb,
                coverage=round(float(coverage[index]), 4),
            )
        )
    return entries


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


def parse_hex_colors(raw: str, field: str) -> list[tuple[int, int, int]]:
    """Parse a JSON array of `#rrggbb` strings sent as a multipart form field."""
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidParameters(f"`{field}` must be a JSON array.", {"field": field}) from exc
    if not isinstance(values, list) or not all(
        isinstance(v, str) and _HEX_COLOR_RE.match(v) for v in values
    ):
        raise InvalidParameters(
            f'`{field}` must be a JSON array of hex colors like "#ff0000".', {"field": field}
        )
    return [hex_to_rgb(v) for v in values]


def parse_palette_indices(raw: str, field: str) -> list[int]:
    """Parse a JSON array of palette indices sent as a multipart form field."""
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidParameters(f"`{field}` must be a JSON array.", {"field": field}) from exc
    if not isinstance(values, list) or not all(
        isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in values
    ):
        raise InvalidParameters(
            f"`{field}` must be a JSON array of palette indices like [0, 2].", {"field": field}
        )
    return sorted(set(values))
