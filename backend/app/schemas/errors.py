"""The error envelope every error response has, for the OpenAPI schema (generated clients
type their error handling from it). See docs/04-backend.md#error-handling."""

from typing import Any

from pydantic import BaseModel, Field


class ErrorModel(BaseModel):
    code: str = Field(
        description="Stable name of the error, e.g. INVALID_PARAMETERS: branch on this"
    )
    message: str = Field(description="What went wrong, to show to people")
    details: dict[str, Any] = Field(
        description="Machine-readable context, e.g. the field or the limit; may be empty"
    )


class ErrorResponse(BaseModel):
    error: ErrorModel
    request_id: str | None = Field(description="The request's X-Request-ID, to quote in reports")


def _error(description: str) -> dict[str, Any]:
    return {"model": ErrorResponse, "description": description}


# Errors every processing (POST) endpoint can answer. Declaring 422 also replaces FastAPI's
# own (`HTTPValidationError`, `{"detail": [...]}`), a body this API never sends.
PROCESSING_ERRORS: dict[int | str, dict[str, Any]] = {
    400: _error("`BAD_REQUEST`: not a valid multipart body"),
    413: _error("`FILE_TOO_LARGE`, or `SVG_TOO_COMPLEX` for an SVG with too many shapes"),
    422: _error(
        "`VALIDATION_ERROR` (fields missing or out of range), `INVALID_PARAMETERS`, "
        "`INVALID_IMAGE`, `IMAGE_TOO_LARGE` or `INVALID_SVG`"
    ),
    500: _error("`INTERNAL_ERROR` (a bug) or `PROCESSING_ERROR`"),
    503: _error("`SERVER_BUSY`: no processing slot came free in time; retry after `Retry-After`"),
}
# Endpoints taking an image (quantize, vectorize, the lithophane export) also refuse
# formats they do not read.
IMAGE_ERRORS: dict[int | str, dict[str, Any]] = {
    **PROCESSING_ERRORS,
    415: _error("`UNSUPPORTED_MEDIA_TYPE`: not an image in a supported format"),
}
