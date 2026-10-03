from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class VectorSnapError(Exception):
    """Base class for domain errors mapped to the API error envelope."""

    status_code = 500
    code = "PROCESSING_ERROR"

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class UnsupportedMediaType(VectorSnapError):
    status_code = 415
    code = "UNSUPPORTED_MEDIA_TYPE"


class FileTooLarge(VectorSnapError):
    status_code = 413
    code = "FILE_TOO_LARGE"


class ImageTooLarge(VectorSnapError):
    status_code = 422
    code = "IMAGE_TOO_LARGE"


class InvalidImage(VectorSnapError):
    status_code = 422
    code = "INVALID_IMAGE"


class InvalidParameters(VectorSnapError):
    status_code = 422
    code = "INVALID_PARAMETERS"


class ProcessingError(VectorSnapError):
    status_code = 500
    code = "PROCESSING_ERROR"


class NotImplementedYet(VectorSnapError):
    status_code = 501
    code = "NOT_IMPLEMENTED"


def error_body(
    request: Request, code: str, message: str, details: dict[str, Any]
) -> dict[str, Any]:
    return {
        "error": {"code": code, "message": message, "details": details},
        "request_id": getattr(request.state, "request_id", None),
    }


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(VectorSnapError)
    async def handle_domain_error(request: Request, exc: VectorSnapError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(request, exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Keep only stable, non-sensitive fields (no echo of the submitted input).
        errors = [
            {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=error_body(
                request, "VALIDATION_ERROR", "Request validation failed.", {"errors": errors}
            ),
        )
