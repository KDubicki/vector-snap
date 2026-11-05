from fastapi import APIRouter

from app.api.routes import export, health, quantize, svg, vectorize
from app.schemas.errors import IMAGE_ERRORS, PROCESSING_ERRORS

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(quantize.router, responses=IMAGE_ERRORS)
api_router.include_router(vectorize.router, responses=IMAGE_ERRORS)
# The exports take an SVG, except the lithophane, which takes an image.
api_router.include_router(export.router, responses=IMAGE_ERRORS)
api_router.include_router(svg.router, responses=PROCESSING_ERRORS)
