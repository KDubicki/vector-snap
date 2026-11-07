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
import math
import time

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


class _Reader:
    """The only reader of a queued request, from its arrival until it is answered.

    What it reads waits here for the app, so the end of the wait never cuts the body
    short: a `receive()` in progress is not cancelled while the request still needs its
    message (ASGI does not promise that cancelling one keeps it; test transports lose
    it). Once the body is in, the next message a server gives is the disconnect: that is
    how a client that left is noticed.
    """

    def __init__(self, receive: Receive) -> None:
        self._receive = receive
        self._messages_in, self._messages_out = anyio.create_memory_object_stream[Message](math.inf)
        self.ended = anyio.Event()  # the client disconnected, or reading failed
        self.failure: Exception | None = None  # a body over the upload limit

    async def run(self) -> None:
        try:
            while True:
                message = await self._receive()
                self._messages_in.send_nowait(message)
                if message["type"] == "http.disconnect":
                    break
        except Exception as error:  # raised again to the app (BodySizeLimitMiddleware)
            self.failure = error
        self._messages_in.close()
        self.ended.set()

    async def receive(self) -> Message:
        """The request's next message, for the app."""
        try:
            return await self._messages_out.receive()
        except anyio.EndOfStream:
            if self.failure is not None:
                raise self.failure from None
            return {"type": "http.disconnect"}


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

        reader = _Reader(receive)
        error: Exception | None = None
        async with anyio.create_task_group() as tasks:
            tasks.start_soon(reader.run)
            try:
                await self._queued(scope, reader, send, waiting)
            except Exception as exc:  # raised below, outside the task group (unwrapped)
                error = exc
            finally:
                tasks.cancel_scope.cancel()  # the request is answered: stop reading it
        if error is not None:
            raise error

    async def _run(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Run the request in the slot it holds."""
        try:
            await self.app(scope, receive, send)
        finally:
            self.slots.release()

    async def _queued(self, scope: Scope, reader: _Reader, send: Send, waiting: float) -> None:
        """Wait for a slot while `reader` reads the request, then run it, or answer that
        the server is busy, or drop it when its client left."""
        acquired = await self._acquire_unless(reader.ended)
        queue_ms = (time.perf_counter() - waiting) * 1000
        record_timing("queue", queue_ms)
        if reader.ended.is_set():  # the client left, or its body was over the limit
            if acquired:
                self.slots.release()
            if reader.failure is not None:
                raise reader.failure
            logger.info(
                "client left while waiting for a processing slot",
                extra={"path": scope["path"], "queue_ms": round(queue_ms)},
            )
            await Response(status_code=CLIENT_CLOSED_REQUEST)(scope, reader.receive, send)
            return
        if not acquired:
            busy = ServerBusy(
                f"The server is busy: all {self.slots.limit} processing slots are taken. "
                f"Try again in {RETRY_AFTER_S} seconds.",
                {"max_concurrent_jobs": self.slots.limit, "retry_after_s": RETRY_AFTER_S},
            )
            response = error_response(Request(scope), busy)
            response.headers["Retry-After"] = str(RETRY_AFTER_S)
            await response(scope, reader.receive, send)
            return
        await self._run(scope, reader.receive, send)

    async def _acquire_unless(self, ended: anyio.Event) -> bool:
        """Wait for a slot (up to the queue timeout) unless `ended` is set first; True
        when a slot was taken."""
        acquired = False
        async with anyio.create_task_group() as tasks:

            async def take() -> None:
                nonlocal acquired
                acquired = await self.slots.acquire()
                tasks.cancel_scope.cancel()

            async def watch() -> None:
                await ended.wait()
                tasks.cancel_scope.cancel()

            tasks.start_soon(take)
            tasks.start_soon(watch)
        return acquired
