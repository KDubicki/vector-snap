import json
import math
import re
from typing import Literal

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


class SvgDeleteResponse(BaseModel):
    svg: str
    colors: int = Field(ge=0, description="Color layers of the edited SVG")
    deleted: list[str] = Field(description="Ids of the removed shapes, in document order")


class SvgMergeResponse(BaseModel):
    svg: str
    colors: int = Field(ge=0, description="Color layers of the edited SVG")
    id: str = Field(description="The merged shape: the id of the largest one")
    merged: list[str] = Field(description="Ids of the shapes united into it, in document order")


class SvgLayerStatsModel(BaseModel):
    palette_index: int
    color: str = Field(pattern=HEX_COLOR_PATTERN)
    shapes: int = Field(ge=0)
    own_colors: int = Field(ge=0, description="Shapes with a color of their own")
    area_px2: float = Field(ge=0, description="Area the layer covers (overlaps counted once)")
    share: float = Field(ge=0, le=1, description="Share of the document area")
    specks: int = Field(ge=0, description="Shapes smaller than `speck_area`")


class SvgStatsResponse(BaseModel):
    width: float
    height: float
    colors: int = Field(ge=0, description="Color layers")
    shapes: int = Field(ge=0)
    specks: int = Field(ge=0, description="Shapes smaller than `speck_area`, every layer")
    layers: list[SvgLayerStatsModel] = Field(description="Bottom to top")


class SvgTransformResponse(BaseModel):
    svg: str
    transformed: list[str] = Field(description="Ids of the transformed shapes")


class SvgSimplifyResponse(BaseModel):
    svg: str
    simplified: list[str] = Field(description="Ids of the shapes that lost points")
    points_before: int = Field(ge=0, description="Outline points of the shapes, flattened")
    points_after: int = Field(ge=0)


class SvgOffsetResponse(BaseModel):
    svg: str
    offset: list[str] = Field(description="Ids of the grown or shrunk shapes")
    removed: list[str] = Field(description="Ids of the shapes shrunk to nothing")


class SvgCropResponse(BaseModel):
    svg: str
    width: float = Field(gt=0, description="The cropped document's width, px")
    height: float = Field(gt=0)
    dx: float = Field(description="How far every shape moved right (negative: left)")
    dy: float = Field(description="How far every shape moved down (negative: up)")


class SvgReorderResponse(BaseModel):
    svg: str
    order: list[int] = Field(description="Palette indices of the layers, bottom to top")


class SvgFillHolesResponse(BaseModel):
    svg: str
    filled: int = Field(ge=0, description="Holes filled")
    shapes: list[str] = Field(description="Ids of the shapes that lost holes")


class SvgProblemModel(BaseModel):
    severity: Literal["error", "warning"]
    code: str = Field(description="Stable name of the problem, e.g. duplicate_id")
    message: str
    ids: list[str] = Field(description="Shapes concerned (at most 50), when it is about shapes")


class SvgValidateResponse(BaseModel):
    valid: bool = Field(description="No errors: edits and exports accept the SVG")
    colors: int = Field(ge=0)
    shapes: int = Field(ge=0)
    problems: list[SvgProblemModel]


# A knife line drawn in the editor has a few hundred points.
MAX_LINE_POINTS = 10_000
MAX_SHAPE_IDS = 10_000


class SvgLassoResponse(BaseModel):
    svg: str
    cut: int = Field(ge=0, description="Shapes the region was cut out of")
    inside: list[str] = Field(description="Ids of the pieces inside the region")
    outside: list[str] = Field(description="Ids of the pieces outside it")


def parse_line(raw: str, field: str, min_points: int = 2) -> list[tuple[float, float]]:
    """Parse a JSON polyline `[[x, y], ...]` of at least `min_points` points (a multipart
    field)."""
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidParameters(f"`{field}` must be a JSON array.", {"field": field}) from exc
    if (
        not isinstance(values, list)
        or not min_points <= len(values) <= MAX_LINE_POINTS
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
            f"`{field}` must be {min_points} to {MAX_LINE_POINTS} points like [[0, 5], [40, 5]].",
            {"field": field},
        )
    return check_distinct_points([(float(x), float(y)) for x, y in values], field)


def check_distinct_points(
    points: list[tuple[float, float]], field: str
) -> list[tuple[float, float]]:
    """The points, refused when they are all the same point (a line or region of no size)."""
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


def parse_layer_order(raw: str, field: str) -> list[int]:
    """Parse a JSON array of palette indices in a given order (a multipart field)."""
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidParameters(f"`{field}` must be a JSON array.", {"field": field}) from exc
    if not isinstance(values, list) or not all(
        isinstance(value, int) and not isinstance(value, bool) and value >= 0 for value in values
    ):
        raise InvalidParameters(
            f"`{field}` must be a JSON array of palette indices like [2, 0, 1].",
            {"field": field},
        )
    return values


class SvgImportResponse(BaseModel):
    svg: str
    width: float = Field(gt=0, description="Document width, px (96 per inch: 210 mm is 793.7)")
    height: float = Field(gt=0)
    colors: int = Field(description="Color layers, in the order the colors first appear")
    shapes: int = Field(description="Shapes of the contract: the visible parts of each color")
    ignored: dict[str, int] = Field(
        description="What was left out or changed, by kind: strokes, text, images, invisible, "
        "unfilled, no_area; gradients (each kept as its average color)"
    )
