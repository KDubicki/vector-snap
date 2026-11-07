import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import anyio
import httpx
import pytest
from fastapi import FastAPI, Request
from starlette.types import Message, Scope

from app.core.body_limit import FORM_FIELDS_ALLOWANCE
from app.core.concurrency import CLIENT_CLOSED_REQUEST, RETRY_AFTER_S, ProcessingSlots
from app.core.config import Settings
from app.core.errors import InvalidParameters
from app.main import create_app

pytestmark = pytest.mark.anyio


@dataclass
class Server:
    app: FastAPI
    client: httpx.AsyncClient
    started: anyio.Event
    finish: anyio.Event
    echoed: list[bytes] = field(default_factory=list)  # bodies the echo route read

    @property
    def slots(self) -> ProcessingSlots:
        slots: ProcessingSlots = self.app.state.processing_slots
        return slots

    async def until_started(self) -> None:
        """Until the slow route runs, holding the slot; a request it never reaches fails
        the test instead of hanging it."""
        with anyio.fail_after(2):
            await self.started.wait()

    async def until(self, *, busy: int, waiting: int = 0) -> None:
        with anyio.fail_after(2):
            while (self.slots.busy, self.slots.waiting) != (busy, waiting):
                await anyio.sleep(0.005)


@asynccontextmanager
async def serve(settings: Settings) -> AsyncIterator[Server]:
    """The app with a slow route holding a slot until `finish`."""
    app = create_app(settings)
    started, finish = anyio.Event(), anyio.Event()
    echoed: list[bytes] = []

    @app.post("/api/v1/test/slow")
    async def slow() -> dict[str, str]:
        started.set()
        await finish.wait()
        return {"done": "slow"}

    @app.post("/api/v1/test/quick")
    async def quick() -> dict[str, str]:
        return {"done": "quick"}

    @app.post("/api/v1/test/broken")
    async def broken() -> None:
        raise InvalidParameters("Broken on purpose.")

    @app.post("/api/v1/test/echo")
    async def echo(request: Request) -> dict[str, int]:
        body = await request.body()
        echoed.append(body)
        return {"bytes": len(body)}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield Server(app, client, started, finish, echoed)


@pytest.fixture
async def server(request: pytest.FixtureRequest) -> AsyncIterator[Server]:
    """One processing slot; the queue timeout is the parameter (5 s by default)."""
    queue_timeout_s = getattr(request, "param", 5.0)
    async with serve(Settings(max_concurrent_jobs=1, queue_timeout_s=queue_timeout_s)) as server:
        yield server


async def test_requests_beyond_the_limit_wait_for_a_slot(server: Server) -> None:
    results: dict[str, httpx.Response] = {}

    async def post(path: str) -> None:
        results[path] = await server.client.post(path)

    async with anyio.create_task_group() as tasks:
        tasks.start_soon(post, "/api/v1/test/slow")
        await server.until_started()
        tasks.start_soon(post, "/api/v1/test/quick")
        await server.until(busy=1, waiting=1)
        assert "/api/v1/test/quick" not in results
        server.finish.set()

    assert results["/api/v1/test/slow"].json() == {"done": "slow"}
    assert results["/api/v1/test/quick"].json() == {"done": "quick"}
    assert (server.slots.busy, server.slots.waiting) == (0, 0)


@pytest.mark.parametrize("server", [0.05], indirect=True)
async def test_a_request_waiting_too_long_is_told_to_retry(server: Server) -> None:
    async with anyio.create_task_group() as tasks:
        tasks.start_soon(server.client.post, "/api/v1/test/slow")
        await server.until_started()

        response = await server.client.post(
            "/api/v1/test/quick", headers={"Origin": "http://localhost:5173"}
        )
        server.finish.set()

    assert response.status_code == 503
    assert response.headers["Retry-After"] == str(RETRY_AFTER_S)
    # A browser can read the answer and when to retry.
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "Retry-After" in response.headers["Access-Control-Expose-Headers"]
    body = response.json()
    assert body["error"]["code"] == "SERVER_BUSY"
    assert body["error"]["details"] == {"max_concurrent_jobs": 1, "retry_after_s": RETRY_AFTER_S}
    assert body["request_id"] == response.headers["X-Request-ID"]
    assert server.slots.busy == 0


@pytest.mark.parametrize("server", [0.0], indirect=True)
async def test_without_a_queue_a_free_slot_is_still_taken(server: Server) -> None:
    first = await server.client.post("/api/v1/test/quick")

    async with anyio.create_task_group() as tasks:
        tasks.start_soon(server.client.post, "/api/v1/test/slow")
        await server.until_started()
        second = await server.client.post("/api/v1/test/quick")
        server.finish.set()

    assert first.status_code == 200
    assert second.status_code == 503


async def test_readiness_reports_running_and_waiting_requests(server: Server) -> None:
    async with anyio.create_task_group() as tasks:
        tasks.start_soon(server.client.post, "/api/v1/test/slow")
        await server.until_started()
        tasks.start_soon(server.client.post, "/api/v1/test/quick")
        await server.until(busy=1, waiting=1)

        ready = await server.client.get("/api/v1/health/ready")
        server.finish.set()

    # Still ready: the queued request is served once the slot frees.
    assert ready.status_code == 200
    assert ready.json()["jobs"] == {"running": 1, "waiting": 1, "limit": 1}


async def test_other_requests_never_wait(server: Server) -> None:
    async with anyio.create_task_group() as tasks:
        tasks.start_soon(server.client.post, "/api/v1/test/slow")
        await server.until_started()

        with anyio.fail_after(1):
            health = await server.client.get("/api/v1/health")
            preflight = await server.client.options(
                "/api/v1/test/quick",
                headers={
                    "Origin": "http://localhost:5173",
                    "Access-Control-Request-Method": "POST",
                },
            )
        server.finish.set()

    assert health.status_code == 200
    assert preflight.status_code == 200


async def test_a_failed_request_frees_its_slot(server: Server) -> None:
    broken = await server.client.post("/api/v1/test/broken")
    quick = await server.client.post("/api/v1/test/quick")

    assert broken.status_code == 422
    assert quick.status_code == 200
    assert server.slots.busy == 0


def _post_scope(path: str) -> Scope:
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"test"), (b"content-length", b"4")],
        "client": ("127.0.0.1", 50000),
        "server": ("test", 80),
    }


async def test_a_request_whose_client_leaves_while_it_waits_is_dropped(
    server: Server, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    left = anyio.Event()
    sent: list[Message] = []
    body_read = False

    async def receive() -> Message:
        nonlocal body_read
        if not body_read:
            body_read = True
            return {"type": "http.request", "body": b"body", "more_body": False}
        await left.wait()  # the frontend aborts a preview it no longer needs
        return {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        sent.append(message)

    async with anyio.create_task_group() as tasks:
        tasks.start_soon(server.client.post, "/api/v1/test/slow")
        await server.until_started()
        tasks.start_soon(server.app, _post_scope("/api/v1/test/echo"), receive, send)
        await server.until(busy=1, waiting=1)
        left.set()
        # Out of the queue at once, without waiting for the slot.
        await server.until(busy=1, waiting=0)
        server.finish.set()

    assert server.echoed == []
    assert sent[0]["status"] == CLIENT_CLOSED_REQUEST
    assert server.slots.busy == 0
    metrics = (await server.client.get("/metrics")).text
    # Refused before routing: no route label, the status tells.
    assert 'method="POST",route="other",status="499"} 1' in metrics
    assert "client left while waiting for a processing slot" in caplog.text
    assert "POST /api/v1/test/echo 499" in caplog.text


async def test_a_waiting_request_is_read_meanwhile_and_reaches_its_route(server: Server) -> None:
    payload = bytes(range(256)) * 4096
    results: dict[str, httpx.Response] = {}

    async def chunks() -> AsyncIterator[bytes]:
        for start in range(0, len(payload), 64 * 1024):
            yield payload[start : start + 64 * 1024]

    async def post_echo() -> None:
        results["echo"] = await server.client.post("/api/v1/test/echo", content=chunks())

    async with anyio.create_task_group() as tasks:
        tasks.start_soon(server.client.post, "/api/v1/test/slow")
        await server.until_started()
        tasks.start_soon(post_echo)
        await server.until(busy=1, waiting=1)
        assert server.echoed == []
        server.finish.set()

    assert results["echo"].json() == {"bytes": len(payload)}
    assert server.echoed == [payload]
    assert (server.slots.busy, server.slots.waiting) == (0, 0)


async def test_a_body_over_the_limit_is_refused_while_it_waits() -> None:
    async def too_much() -> AsyncIterator[bytes]:
        chunk = b"x" * (1024 * 1024)
        for _ in range(1 + FORM_FIELDS_ALLOWANCE // len(chunk) + 1):
            yield chunk

    settings = Settings(max_concurrent_jobs=1, queue_timeout_s=5.0, max_upload_mb=1)
    async with serve(settings) as server, anyio.create_task_group() as tasks:
        tasks.start_soon(server.client.post, "/api/v1/test/slow")
        await server.until_started()

        with anyio.fail_after(2):
            response = await server.client.post("/api/v1/test/echo", content=too_much())
        assert (server.slots.busy, server.slots.waiting) == (1, 0)
        server.finish.set()

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "FILE_TOO_LARGE"
    assert server.echoed == []
    assert server.slots.busy == 0


async def test_a_slot_freed_while_the_body_arrives_loses_none_of_it(server: Server) -> None:
    """The slot frees while a body chunk is on its way: a transport may take a chunk
    before it hands it over, and lose it if that `receive()` is cancelled (on GitHub's
    runners the echo got 960 of 1024 KB)."""
    arrive = anyio.Event()
    calls = 0
    sent: list[Message] = []

    async def receive() -> Message:
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"type": "http.request", "body": b"a" * 10, "more_body": True}
        if calls == 2:
            chunk = b"b" * 10  # taken from the network, not handed over yet
            await arrive.wait()
            return {"type": "http.request", "body": chunk, "more_body": True}
        if calls == 3:
            return {"type": "http.request", "body": b"c" * 10, "more_body": False}
        await anyio.sleep_forever()  # the client stays until it has its answer
        raise AssertionError

    async def send(message: Message) -> None:
        sent.append(message)

    scope = _post_scope("/api/v1/test/echo")
    scope["headers"] = [(b"host", b"test"), (b"content-length", b"30")]
    async with anyio.create_task_group() as tasks:
        tasks.start_soon(server.client.post, "/api/v1/test/slow")
        await server.until_started()
        tasks.start_soon(server.app, scope, receive, send)
        await server.until(busy=1, waiting=1)
        server.finish.set()  # the slot frees while the second chunk is on its way
        await server.until(busy=1, waiting=0)
        await anyio.sleep(0.05)
        arrive.set()
        with anyio.fail_after(2):
            while not any(message.get("type") == "http.response.body" for message in sent):
                await anyio.sleep(0.005)

    assert server.echoed == [b"a" * 10 + b"b" * 10 + b"c" * 10]
    assert sent[0]["status"] == 200
