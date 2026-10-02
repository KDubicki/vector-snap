import logging
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response

REQUEST_ID_HEADER = "X-Request-ID"


def configure_logging(level: str) -> None:
    # TODO: switch to JSON output in production (see docs/04-backend.md#observability).
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


async def request_id_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = request_id
    return response
