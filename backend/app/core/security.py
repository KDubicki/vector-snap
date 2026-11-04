"""Security headers on every API response.

The API returns JSON, SVG and files to download, never pages to render, so a browser
that opens a response (a form posted from another site, a link to an SVG) must not
sniff it into HTML, run scripts in it or frame it. nginx adds `nosniff` in front of the
frontend too; these cover the backend reached directly (port 8000) and other services
calling it. The interactive docs (/docs, /redoc) load scripts and are left alone. See
docs/04-backend.md#security-considerations.
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

API_PREFIX = "/api/"

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    # Nothing in a response may load, run or be framed (an SVG opened in a tab included).
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
}


class SecurityHeadersMiddleware:
    """Adds `SECURITY_HEADERS` to responses under /api/ that do not set them."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(API_PREFIX):
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)
