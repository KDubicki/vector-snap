from collections.abc import AsyncIterator, Iterator
from typing import Annotated

import httpx
import pytest
from fastapi import FastAPI, File, UploadFile
from fastapi.testclient import TestClient
from starlette.responses import PlainTextResponse
from starlette.types import Receive, Scope, Send

from app.core.body_limit import FORM_FIELDS_ALLOWANCE, BodySizeLimitMiddleware
from app.core.config import Settings
from app.main import create_app

MB = 1024 * 1024


def _app(max_upload_mb: int) -> tuple[FastAPI, list[int]]:
    """The app with a route that counts the uploads it got to read."""
    app = create_app(Settings(max_upload_mb=max_upload_mb))
    reached: list[int] = []

    @app.post("/api/v1/test/upload")
    async def upload(file: Annotated[UploadFile, File()]) -> dict[str, bool]:
        data = await file.read()
        reached.append(len(data))
        # SpooledTemporaryFile: rolled over means written to a file on disk.
        return {"on_disk": bool(getattr(file.file, "_rolled", True))}

    return app, reached


def _over_the_limit(max_upload_mb: int) -> int:
    return max_upload_mb * MB + FORM_FIELDS_ALLOWANCE + 1


def test_a_body_announced_too_large_is_refused_unread() -> None:
    app, reached = _app(1)
    response = TestClient(app).post(
        "/api/v1/test/upload", files={"file": ("big.bin", b"x" * _over_the_limit(1))}
    )

    assert response.status_code == 413
    body = response.json()
    assert body["error"]["code"] == "FILE_TOO_LARGE"
    assert body["error"]["details"] == {"max_upload_mb": 1}
    assert body["request_id"] == response.headers["X-Request-ID"]
    assert reached == []


def test_a_chunked_body_is_refused_once_it_passes_the_limit() -> None:
    app, reached = _app(1)
    boundary = "vectorsnap"
    head = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\n\r\n'
    ).encode()

    def chunks() -> Iterator[bytes]:
        yield head
        for _ in range(_over_the_limit(1) // MB + 1):
            yield b"x" * MB
        yield f"\r\n--{boundary}--\r\n".encode()

    response = TestClient(app).post(
        "/api/v1/test/upload",
        content=chunks(),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )

    assert "content-length" not in {k.lower() for k in response.request.headers}
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "FILE_TOO_LARGE"
    assert reached == []


@pytest.mark.parametrize("size_mb", [0.5, 3])
def test_uploads_within_the_limit_stay_in_memory(size_mb: float) -> None:
    app, reached = _app(10)
    size = int(size_mb * MB)
    with TestClient(app) as client:  # the lifespan passes the middleware too
        response = client.post("/api/v1/test/upload", files={"file": ("image.png", b"x" * size)})

    assert response.status_code == 200
    assert response.json() == {"on_disk": False}
    assert reached == [size]


async def _read_all_then_answer(scope: Scope, receive: Receive, send: Send) -> None:
    """A bare ASGI app reading the whole body, as any app may, without catching errors."""
    if scope["type"] != "http":
        return
    while (await receive()).get("more_body"):
        pass
    await PlainTextResponse("read")(scope, receive, send)


async def _crash(scope: Scope, receive: Receive, send: Send) -> None:
    raise RuntimeError("not about the body")


@pytest.mark.anyio
async def test_a_reader_stopped_by_the_limit_gets_the_refusal_too() -> None:
    app = BodySizeLimitMiddleware(_read_all_then_answer, max_upload_mb=0)

    async def chunks() -> AsyncIterator[bytes]:
        for _ in range(FORM_FIELDS_ALLOWANCE // MB + 1):
            yield b"x" * MB

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        refused = await client.post("/", content=chunks())
        small = await client.post("/", content=b"x" * 10)

    assert refused.status_code == 413
    assert refused.json()["error"]["code"] == "FILE_TOO_LARGE"
    assert small.text == "read"


@pytest.mark.anyio
async def test_other_errors_pass_through() -> None:
    transport = httpx.ASGITransport(app=BodySizeLimitMiddleware(_crash, max_upload_mb=1))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        with pytest.raises(RuntimeError, match="not about the body"):
            await client.post("/", content=b"x")
