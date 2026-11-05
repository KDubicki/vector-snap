"""Refuse a request body over the upload limit before reading it, and keep uploads in memory.

`read_upload` checks a file once the form is parsed, but parsing reads the whole body
first, and Starlette writes file parts over 1 MB to temporary files on disk. Here a body
over the limit is refused as it arrives: at once when its `Content-Length` says so,
otherwise (a chunked body) as soon as the bytes received pass the limit. Within the
limit, file parts stay in memory, so nothing is written to disk and a read-only file
system works. See docs/04-backend.md#security-considerations.
"""

from starlette.datastructures import Headers
from starlette.formparsers import MultiPartParser
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import FileTooLarge, error_response

# Room for the form fields besides the file (shape ids, a knife line, batch steps: at most
# 1 MB each) and the multipart boundaries.
FORM_FIELDS_ALLOWANCE = 4 * 1024 * 1024


class BodyTooLarge(Exception):
    """Stops whoever reads a body past the limit."""


class BodySizeLimitMiddleware:
    """Answers `413 FILE_TOO_LARGE` for a body over the upload limit plus the form fields."""

    def __init__(self, app: ASGIApp, max_upload_mb: int) -> None:
        self.app = app
        self.max_upload_mb = max_upload_mb
        self.max_bytes = max_upload_mb * 1024 * 1024 + FORM_FIELDS_ALLOWANCE
        # Parts up to the limit stay in memory (Starlette's default spools over 1 MB to
        # disk). A class attribute: one setting for the process, as the upload limit is.
        MultiPartParser.spool_max_size = self.max_bytes

    def _refusal(self, scope: Scope) -> Response:
        return error_response(
            Request(scope),
            FileTooLarge(
                f"Request exceeds the limit of {self.max_upload_mb} MB.",
                {"max_upload_mb": self.max_upload_mb},
            ),
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        length = Headers(scope=scope).get("content-length", "")
        if length.isdigit() and int(length) > self.max_bytes:
            await self._refusal(scope)(scope, receive, send)
            return

        received = 0
        exceeded = False
        started = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    exceeded = True
                    raise BodyTooLarge
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if exceeded and not started:
                return  # the app's answer to a body cut short; the refusal replaces it
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception:
            if not exceeded or started:
                raise
        if exceeded and not started:
            await self._refusal(scope)(scope, receive, send)
