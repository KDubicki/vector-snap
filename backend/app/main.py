from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES, GZipMiddleware

from app import __version__
from app.api.router import api_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, request_id_middleware

# Responses smaller than this are sent as they are: gzip saves too little on them.
GZIP_MINIMUM_BYTES = 1024
# Already compressed (besides images and ZIPs, which Starlette skips): a 3MF is a ZIP.
GZIP_SKIPPED_TYPES = (*DEFAULT_EXCLUDED_CONTENT_TYPES, "model/3mf")


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, json_logs=settings.is_production)

    app = FastAPI(
        title="VectorSnap API",
        version=__version__,
        description="Stateless service converting raster images (JPEG/PNG) to SVG.",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
    )
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
        expose_headers=["X-Request-ID", "X-Stencil-Bridges"],
    )
    app.middleware("http")(request_id_middleware)
    register_exception_handlers(app)
    app.include_router(api_router)
    return app


app = create_app()
