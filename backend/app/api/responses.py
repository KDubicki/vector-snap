"""Responses the routes share."""

import json
from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import Request, Response
from fastapi.routing import APIRoute

SVG_MEDIA_TYPE = "image/svg+xml"


def attachment(content: bytes, media_type: str, extension: str) -> Response:
    """A file to download, named `vectorsnap.<extension>`."""
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="vectorsnap.{extension}"'},
    )


def wants_svg(request: Request) -> bool:
    """The client asked for the SVG itself (`Accept: image/svg+xml`), not the JSON."""
    accept = request.headers.get("accept", "")
    return SVG_MEDIA_TYPE in accept and "application/json" not in accept


class SvgEditRoute(APIRoute):
    """An SVG edit: with `Accept: image/svg+xml` it answers with the edited document itself
    instead of the JSON envelope, so a script can pipe one edit into the next. Errors stay
    JSON. See docs/05-api-specification.md#svg."""

    def __init__(self, path: str, endpoint: Callable[..., Any], **kwargs: Any) -> None:
        responses = dict(kwargs.pop("responses", None) or {})
        ok = dict(responses.get(200, {}))
        ok["content"] = {**ok.get("content", {}), SVG_MEDIA_TYPE: {"schema": {"type": "string"}}}
        responses[200] = ok
        super().__init__(path, endpoint, responses=responses, **kwargs)

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            response = await handler(request)
            if response.status_code == 200 and wants_svg(request):
                svg = json.loads(bytes(response.body))["svg"]
                return Response(svg, media_type=SVG_MEDIA_TYPE)
            return response

        return handle
