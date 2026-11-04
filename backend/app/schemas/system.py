from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    version: str


class JobsModel(BaseModel):
    running: int = Field(ge=0, description="Processing requests holding a slot")
    waiting: int = Field(ge=0, description="Processing requests queued for a slot")
    limit: int = Field(ge=1, description="Slots of this worker (max_concurrent_jobs)")


class ReadyResponse(HealthResponse):
    jobs: JobsModel = Field(description="Load of the worker that answered")


class LimitsResponse(BaseModel):
    max_upload_mb: int
    max_image_dimension: int
    min_colors: int
    max_colors: int
    max_svg_shapes: int
    supported_formats: list[str]
