from fastapi import APIRouter

from app.api.routes import export, health, quantize, vectorize

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(quantize.router)
api_router.include_router(vectorize.router)
api_router.include_router(export.router)
