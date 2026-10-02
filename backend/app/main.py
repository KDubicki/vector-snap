from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.router import api_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, request_id_middleware


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="VectorSnap API",
        version=__version__,
        description="Stateless service converting raster images (JPEG/PNG) to SVG.",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
    app.middleware("http")(request_id_middleware)
    register_exception_handlers(app)
    app.include_router(api_router)
    return app


app = create_app()
