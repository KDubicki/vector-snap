"""At most `max_concurrent_jobs` processing requests at once; the others wait for a slot.

Every POST under /api/v1 decodes an image or SVG and runs CPU and memory heavy work in the
thread pool (quantizing a 4096 px photo, building a 3D model). Dozens of them at once
slow every one down and can exhaust the container's memory, so requests beyond the limit
queue, and one that waits longer than `queue_timeout_s` is answered `503 SERVER_BUSY`
with `Retry-After`. Other requests (health checks, limits, CORS preflights) never wait.
The limit holds per worker process. See docs/04-backend.md#concurrency.

A waiting request is read meanwhile, so it starts at once when a slot frees, and one
whose client leaves while it waits (the frontend aborts a preview it no longer needs
when a slider moves on) is dropped instead of processed for nobody.
"""

import logging
import time
from collections import deque
from dataclasses import dataclass

import anyio
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import ServerBusy, error_response
from app.core.logging import record_timing

# Seconds a client is told to wait before trying a busy server again.
RETRY_AFTER_S = 5
# Status of a request whose client left while it waited (nginx's "client closed
# request"): only the access log shows it, nobody is there to receive it.
CLIENT_CLOSED_REQUEST = 499

logger = logging.getLogger(__name__)


class ProcessingSlots:
    """The processing requests one worker process runs at once."""

    def __init__(self, limit: int, queue_timeout_s: float) -> None:
        self.limit = limit
        self.queue_timeout_s = queue_timeout_s
        self._semaphore = anyio.Semaphore(limit, max_value=limit)

    @property
    def busy(self) -> int:
        """Slots taken by running requests."""
        return self.limit - self._semaphore.value

    @property
    def waiting(self) -> int:
        """Requests queued for a slot."""
        return self._semaphore.statistics().tasks_waiting

    def try_acquire(self) -> bool:
        """Take a free slot without waiting; False when all are taken."""
        try:
            self._semaphore.acquire_nowait()
            return True
        except anyio.WouldBlock:
            return False

    async def acquire(self) -> bool:
        """Take a slot, waiting up to `queue_timeout_s`; False when none came free."""
        # A free slot is taken at once, also with a timeout of 0 (whose cancel scope
        # would stop `acquire` before it looks).
        if self.try_acquire():
            return True
        with anyio.move_on_after(self.queue_timeout_s):
            await self._semaphore.acquire()
            return True
        return False

    def release(self) -> None:
        self._semaphore.release()


@dataclass
class _Waited:
    acquired: bool  # a slot came free
    left: bool  # the client disconnected first
    read: deque[Message]  # the request's messages read while waiting


class ProcessingLimitMiddleware:
    """Runs each POST request in a processing slot, or answers 503 when none comes free."""

    def __init__(self, app: ASGIApp, slots: ProcessingSlots) -> None:
        self.app = app
        self.slots = slots

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return
        waiting = time.perf_counter()
        if self.slots.try_acquire():
            record_timing("queue", (time.perf_counter() - waiting) * 1000)
            await self._run(scope, receive, send)
            return
        waited = await self._wait(receive)
        queue_ms = (time.perf_counter() - waiting) * 1000
        record_timing("queue", queue_ms)
        if waited.left:
            if waited.acquired:
                self.slots.release()
            logger.info(
                "client left while waiting for a processing slot",
                extra={"path": scope["path"], "queue_ms": round(queue_ms)},
            )
            await Response(status_code=CLIENT_CLOSED_REQUEST)(scope, receive, send)
            return
        if not waited.acquired:
            busy = ServerBusy(
                f"The server is busy: all {self.slots.limit} processing slots are taken. "
                f"Try again in {RETRY_AFTER_S} seconds.",
                {"max_concurrent_jobs": self.slots.limit, "retry_after_s": RETRY_AFTER_S},
            )
            response = error_response(Request(scope), busy)
            response.headers["Retry-After"] = str(RETRY_AFTER_S)
            await response(scope, receive, send)
            return

        async def replay() -> Message:
            return waited.read.popleft() if waited.read else await receive()

        await self._run(scope, replay, send)

    async def _run(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Run the request in the slot it holds."""
        try:
            await self.app(scope, receive, send)
        finally:
            self.slots.release()

    async def _wait(self, receive: Receive) -> _Waited:
        """Wait for a slot while reading the request, until a slot comes free, the
        queue timeout passes or the client disconnects.

        Once its body is in, the next message a server gives is the disconnect, so
        reading on is how a client that left is noticed. A body over the upload limit
        fails the read (`BodySizeLimitMiddleware`): that error is raised here, the
        slot not kept.
        """
        waited = _Waited(acquired=False, left=False, read=deque())
        failure: Exception | None = None

        async with anyio.create_task_group() as tasks:

            async def read_request() -> None:
                nonlocal failure
                try:
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            waited.left = True
                            break
                        waited.read.append(message)
                except Exception as error:
                    failure = error
                tasks.cancel_scope.cancel()

            async def wait_for_slot() -> None:
                waited.acquired = await self.slots.acquire()
                tasks.cancel_scope.cancel()

            tasks.start_soon(read_request)
            tasks.start_soon(wait_for_slot)

        if failure is not None:
            if waited.acquired:
                self.slots.release()
            raise failure
        return waited
