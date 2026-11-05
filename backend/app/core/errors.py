import logging
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send


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


class SvgTooComplex(VectorSnapError):
    """Raised for an SVG with more shapes than `max_svg_shapes`."""

    status_code = 413
    code = "SVG_TOO_COMPLEX"


class ImageTooLarge(VectorSnapError):
    status_code = 422
    code = "IMAGE_TOO_LARGE"


class InvalidImage(VectorSnapError):
    status_code = 422
    code = "INVALID_IMAGE"


class InvalidParameters(VectorSnapError):
    status_code = 422
    code = "INVALID_PARAMETERS"


class InvalidSvg(VectorSnapError):
    status_code = 422
    code = "INVALID_SVG"


class NotIndexedImage(InvalidImage):
    """Raised when an indexed (palette-mode) PNG was expected."""


class ProcessingError(VectorSnapError):
    status_code = 500
    code = "PROCESSING_ERROR"


class ServerBusy(VectorSnapError):
    """Every processing slot stayed taken for `queue_timeout_s` (see app.core.concurrency)."""

    status_code = 503
    code = "SERVER_BUSY"


def error_body(
    request: Request, code: str, message: str, details: dict[str, Any]
) -> dict[str, Any]:
    return {
        "error": {"code": code, "message": message, "details": details},
        "request_id": getattr(request.state, "request_id", None),
    }


def error_response(request: Request, exc: VectorSnapError) -> JSONResponse:
    """The error envelope of a domain error, for handlers and middleware alike."""
    return JSONResponse(
        status_code=exc.status_code,
        content=error_body(request, exc.code, exc.message, exc.details),
    )


def _http_error(request: Request, exc: HTTPException) -> tuple[str, str, dict[str, Any]]:
    """Code, message and details of an error the framework raised: no route for the path
    or method, a body that is not valid multipart."""
    try:
        code = HTTPStatus(exc.status_code).name
    except ValueError:
        code = "HTTP_ERROR"
    if exc.status_code == 404:
        return code, f"No endpoint at {request.url.path}.", {"path": request.url.path}
    if exc.status_code == 405:
        allowed = [m.strip() for m in (exc.headers or {}).get("Allow", "").split(",") if m.strip()]
        use = " or ".join(allowed) or "another method"
        return code, f"{request.method} is not allowed here; use {use}.", {"allowed": allowed}
    return code, str(exc.detail), {}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(VectorSnapError)
    async def handle_domain_error(request: Request, exc: VectorSnapError) -> JSONResponse:
        return error_response(request, exc)

    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, exc: HTTPException) -> JSONResponse:
        code, message, details = _http_error(request, exc)
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(request, code, message, details),
            headers=exc.headers,
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


INTERNAL_ERROR_MESSAGE = (
    "The server failed to process the request. Quote the request id when reporting it."
)
error_logger = logging.getLogger("app.errors")


class UnhandledErrorMiddleware:
    """Answers an exception no handler took (a bug) with a 500 in the error envelope.

    It sits inside the other middleware, unlike Starlette's own 500 page, so the answer
    still carries the request id, CORS headers (a browser can read it) and gzip. The
    traceback goes to the log only; the client sees no internals.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def send_tracking(message: Message) -> None:
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, receive, send_tracking)
        except Exception:
            if started:  # too late for another answer
                raise
            error_logger.exception("unhandled error")
            request = Request(scope)
            response = JSONResponse(
                status_code=500,
                content=error_body(request, "INTERNAL_ERROR", INTERNAL_ERROR_MESSAGE, {}),
            )
            await response(scope, receive, send)
