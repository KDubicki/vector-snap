from typing import Annotated

from fastapi import APIRouter, Depends

from app import __version__
from app.core.config import Settings, get_settings
from app.schemas.system import HealthResponse, LimitsResponse
from app.services.image_io import SUPPORTED_FORMATS

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__)


@router.get("/health/ready", response_model=HealthResponse)
async def ready() -> HealthResponse:
    return HealthResponse(status="ready", version=__version__)


@router.get("/limits", response_model=LimitsResponse)
async def limits(settings: Annotated[Settings, Depends(get_settings)]) -> LimitsResponse:
    return LimitsResponse(
        max_upload_mb=settings.max_upload_mb,
        max_image_dimension=settings.max_image_dimension,
        min_colors=settings.min_colors,
        max_colors=settings.max_colors,
        supported_formats=list(SUPPORTED_FORMATS.values()),
    )
