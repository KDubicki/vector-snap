from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    version: str


class LimitsResponse(BaseModel):
    max_upload_mb: int
    max_image_dimension: int
    min_colors: int
    max_colors: int
    supported_formats: list[str]
