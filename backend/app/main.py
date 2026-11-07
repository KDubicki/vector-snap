from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES, GZipMiddleware

from app import __version__
from app.api.router import api_router
from app.core.body_limit import BodySizeLimitMiddleware
from app.core.concurrency import ProcessingLimitMiddleware, ProcessingSlots
from app.core.config import Settings, get_settings
from app.core.errors import UnhandledErrorMiddleware, register_exception_handlers
from app.core.logging import configure_logging, request_id_middleware
from app.core.metrics import CONTENT_TYPE, Metrics
from app.core.security import SecurityHeadersMiddleware

# Responses smaller than this are sent as they are: gzip saves too little on them.
GZIP_MINIMUM_BYTES = 1024
# Already compressed (besides images and ZIPs, which Starlette skips): a 3MF is a ZIP.
GZIP_SKIPPED_TYPES = (*DEFAULT_EXCLUDED_CONTENT_TYPES, "model/3mf")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json_logs=settings.is_production)

    app = FastAPI(
        title="VectorSnap API",
        version=__version__,
        description="Stateless service converting raster images (JPEG, PNG, WebP, AVIF, GIF, BMP, "
        "TIFF) to SVG.",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
    )
    # Innermost of the middleware: a request waiting for a slot holds no resources yet,
    # and the 503 of one that waited too long still gets CORS headers and a request id.
    # Innermost: a bug's 500 still passes the middleware below (request id, CORS, gzip).
    app.add_middleware(UnhandledErrorMiddleware)
    slots = ProcessingSlots(settings.max_concurrent_jobs, settings.queue_timeout_s)
    app.state.processing_slots = slots
    app.add_middleware(ProcessingLimitMiddleware, slots=slots)
    # Outside the slots: a body over the limit is refused before it waits for one.
    app.add_middleware(BodySizeLimitMiddleware, max_upload_mb=settings.max_upload_mb)
    # SVGs, their JSON envelopes, STL, DXF and EPS shrink to a fifth to two fifths;
    # level 6 compresses them as well as 9, in less time.
    app.add_middleware(
        GZipMiddleware,
        minimum_size=GZIP_MINIMUM_BYTES,
        compresslevel=6,
        exclude_content_types=GZIP_SKIPPED_TYPES,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-Stencil-Bridges", "Retry-After"],
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.middleware("http")(request_id_middleware)
    register_exception_handlers(app)
    app.include_router(api_router)

    # For Prometheus inside the deployment: at the root, outside /api/, so nginx does
    # not serve it to browsers. Per worker process, like the readiness probe's load.
    metrics = Metrics()
    app.state.metrics = metrics

    @app.get("/metrics", include_in_schema=False)
    async def prometheus_metrics() -> Response:
        return Response(metrics.render(slots, __version__), media_type=CONTENT_TYPE)

    return app


app = create_app()
