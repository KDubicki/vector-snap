from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app import __version__
from app.core.concurrency import ProcessingSlots
from app.core.config import Settings, get_settings
from app.schemas.system import HealthResponse, JobsModel, LimitsResponse, ReadyResponse
from app.services.image_io import SUPPORTED_FORMATS

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__)


@router.get("/health/ready", response_model=ReadyResponse)
async def ready(request: Request) -> ReadyResponse:
    """Ready while the app serves (its libraries load before it does), with the load of
    this worker for monitoring and autoscaling. It stays ready when every slot is busy:
    requests then queue, while a not-ready answer would take a lone replica out of a
    load balancer and fail all of them."""
    slots: ProcessingSlots = request.app.state.processing_slots
    return ReadyResponse(
        status="ready",
        version=__version__,
        jobs=JobsModel(running=slots.busy, waiting=slots.waiting, limit=slots.limit),
    )


@router.get("/limits", response_model=LimitsResponse)
async def limits(settings: Annotated[Settings, Depends(get_settings)]) -> LimitsResponse:
    return LimitsResponse(
        max_upload_mb=settings.max_upload_mb,
        max_image_dimension=settings.max_image_dimension,
        min_colors=settings.min_colors,
        max_colors=settings.max_colors,
        max_svg_shapes=settings.max_svg_shapes,
        supported_formats=list(SUPPORTED_FORMATS.values()),
    )
