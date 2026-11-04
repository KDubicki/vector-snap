from collections.abc import AsyncIterator
from dataclasses import dataclass

import anyio
import httpx
import pytest
from fastapi import FastAPI

from app.core.concurrency import RETRY_AFTER_S, ProcessingSlots
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


@pytest.fixture
async def server(request: pytest.FixtureRequest) -> AsyncIterator[Server]:
    """The app with one processing slot and a slow route holding it until `finish`."""
    queue_timeout_s = getattr(request, "param", 5.0)
    app = create_app(Settings(max_concurrent_jobs=1, queue_timeout_s=queue_timeout_s))
    started, finish = anyio.Event(), anyio.Event()

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

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield Server(app, client, started, finish)


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
