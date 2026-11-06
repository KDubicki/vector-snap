from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from app import __version__
from app.core.concurrency import ProcessingSlots
from app.core.config import Settings, get_settings
from app.schemas.system import HealthResponse, JobsModel, LimitsResponse, ReadyResponse
from app.services.image_io import SUPPORTED_FORMATS

router = APIRouter(tags=["system"])


def probe(path: str, **kwargs: Any) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """A GET endpoint that answers HEAD too (headers only). Uptime monitors and load
    balancers often probe with HEAD (UptimeRobot does by default, as does `curl -I`),
    and FastAPI answers only the methods a route names, so a GET-only probe was 405 and
    the service reported down. HEAD stays out of the schema: one route for both would
    give both operations the same operationId."""

    def register(endpoint: Callable[..., Any]) -> Callable[..., Any]:
        # GET first: a 405 for another method names the first matching route's methods.
        router.get(path, **kwargs)(endpoint)
        router.head(path, include_in_schema=False, **kwargs)(endpoint)
        return endpoint

    return register


@probe("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__)


@probe("/health/ready", response_model=ReadyResponse)
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


@probe("/limits", response_model=LimitsResponse)
async def limits(settings: Annotated[Settings, Depends(get_settings)]) -> LimitsResponse:
    return LimitsResponse(
        max_upload_mb=settings.max_upload_mb,
        max_image_dimension=settings.max_image_dimension,
        min_colors=settings.min_colors,
        max_colors=settings.max_colors,
        max_svg_shapes=settings.max_svg_shapes,
        supported_formats=list(SUPPORTED_FORMATS.values()),
    )
