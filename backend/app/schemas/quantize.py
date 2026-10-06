from enum import StrEnum

from pydantic import BaseModel, Field

from app.schemas.palette import PaletteColor


class QuantizeAlgorithm(StrEnum):
    KMEANS = "kmeans"
    MEDIAN_CUT = "median_cut"


class EncodedImage(BaseModel):
    media_type: str = "image/png"
    encoding: str = "base64"
    data: str


class QuantizeResponse(BaseModel):
    width: int
    height: int
    palette: list[PaletteColor]
    has_transparency: bool
    image: EncodedImage


class ColorCountError(BaseModel):
    colors: int
    mean_delta_e: float = Field(description="Mean CIE76 color difference to the original")


class ColorSuggestionResponse(BaseModel):
    colors: int
    target_delta_e: float
    errors: list[ColorCountError]
