"""Operations of `POST /svg/batch`: the SVG edits as JSON steps, with the same limits as
their own endpoints. See docs/05-api-specification.md#post-apiv1svgbatch."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, TypeAdapter

from app.schemas.palette import HEX_COLOR_PATTERN
from app.schemas.svg import MAX_LINE_POINTS, MAX_SHAPE_IDS

HexColor = Annotated[str, Field(pattern=HEX_COLOR_PATTERN)]
ShapeIds = Annotated[list[str], Field(max_length=MAX_SHAPE_IDS)]
# A point in document px, [x, y].
Point = tuple[FiniteFloat, FiniteFloat]

# Steps one batch may hold.
MAX_STEPS = 50


class _Step(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DeleteStep(_Step):
    op: Literal["delete"]
    ids: ShapeIds = []
    smaller_than: float = Field(0.0, ge=0, le=1_000_000)
    layers: list[Annotated[int, Field(ge=0)]] = []


class MergeStep(_Step):
    op: Literal["merge"]
    ids: Annotated[list[str], Field(min_length=2, max_length=MAX_SHAPE_IDS)]


class SplitStep(_Step):
    op: Literal["split"]
    line: Annotated[list[Point], Field(min_length=2, max_length=MAX_LINE_POINTS)]
    ids: ShapeIds = []


class LassoStep(_Step):
    op: Literal["lasso"]
    region: Annotated[list[Point], Field(min_length=3, max_length=MAX_LINE_POINTS)]
    ids: ShapeIds = []


class MergeSimilarStep(_Step):
    op: Literal["merge_similar"]
    max_delta_e: float = Field(2.0, gt=0, le=10)


class RecolorStep(_Step):
    op: Literal["recolor"]
    colors: dict[HexColor, HexColor] = {}
    filaments: Annotated[list[HexColor], Field(max_length=128)] = []


class SimplifyStep(_Step):
    op: Literal["simplify"]
    tolerance: float = Field(0.5, gt=0, le=50)
    ids: ShapeIds = []


class OffsetStep(_Step):
    op: Literal["offset"]
    distance: float = Field(ge=-100, le=100)
    corners: Literal["round", "sharp"] = "round"
    ids: ShapeIds = []


class FillHolesStep(_Step):
    op: Literal["fill_holes"]
    smaller_than: float = Field(25.0, gt=0, le=1_000_000)
    ids: ShapeIds = []


class TransformStep(_Step):
    op: Literal["transform"]
    dx: float = Field(0.0, ge=-1_000_000, le=1_000_000)
    dy: float = Field(0.0, ge=-1_000_000, le=1_000_000)
    scale: float = Field(1.0, gt=0, le=100)
    rotate: float = Field(0.0, ge=-360, le=360)
    flip: Literal["none", "x", "y"] = "none"
    ids: ShapeIds = []


class CropStep(_Step):
    op: Literal["crop"]
    padding: float = Field(0.0, ge=0, le=10_000)
    ignore_colors: list[Annotated[int, Field(ge=0)]] = []


class ReorderStep(_Step):
    op: Literal["reorder"]
    order: list[Annotated[int, Field(ge=0)]] = []
    sort: Literal["light_to_dark", "dark_to_light", "largest_first"] | None = None


Step = Annotated[
    DeleteStep
    | MergeStep
    | SplitStep
    | LassoStep
    | MergeSimilarStep
    | RecolorStep
    | SimplifyStep
    | OffsetStep
    | FillHolesStep
    | TransformStep
    | CropStep
    | ReorderStep,
    Field(discriminator="op"),
]
STEPS: TypeAdapter[list[Step]] = TypeAdapter(
    Annotated[list[Step], Field(min_length=1, max_length=MAX_STEPS)]
)


class SvgBatchStepModel(BaseModel):
    op: str
    changed: int = Field(
        ge=0, description="What the step changed: shapes, colors, holes or layers, per op"
    )


class SvgBatchResponse(BaseModel):
    svg: str
    steps: list[SvgBatchStepModel] = Field(description="One per operation, in order")
