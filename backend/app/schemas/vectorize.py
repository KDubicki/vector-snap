from enum import StrEnum

from pydantic import BaseModel

from app.schemas.palette import PaletteColor


class TracingMode(StrEnum):
    SPLINE = "spline"
    POLYGON = "polygon"


class Stacking(StrEnum):
    STACKED = "stacked"
    CUTOUT = "cutout"


class VectorizeStats(BaseModel):
    paths: int
    bytes: int
    duration_ms: int


class VectorizeResponse(BaseModel):
    width: int
    height: int
    palette: list[PaletteColor]
    stats: VectorizeStats
    svg: str
