from enum import StrEnum

from pydantic import BaseModel, Field

from app.schemas.palette import PaletteColor


class QuantizeAlgorithm(StrEnum):
    KMEANS = "kmeans"
    MEDIAN_CUT = "median_cut"
    FILAMENTS = "filaments"


class EncodedImage(BaseModel):
    media_type: str = "image/png"
    encoding: str = "base64"
    data: str


class MergedColorModel(BaseModel):
    hex: str = Field(description="The small color, left out of the palette")
    into: str = Field(description="The palette color its pixels now have")
    coverage: float = Field(description="Its share of the image before merging")


class QuantizeResponse(BaseModel):
    width: int
    height: int
    palette: list[PaletteColor]
    has_transparency: bool
    background_index: int | None = Field(
        default=None, description="Palette index dominating the image border (background)"
    )
    merged: list[MergedColorModel] = Field(
        default_factory=list,
        description="Colors under min_coverage merged into their nearest, smallest first",
    )
    image: EncodedImage


class ColorCountError(BaseModel):
    colors: int
    mean_delta_e: float = Field(description="Mean CIE76 color difference to the original")


class ColorSuggestionResponse(BaseModel):
    colors: int
    target_delta_e: float
    errors: list[ColorCountError]
