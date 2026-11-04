"""At most `max_concurrent_jobs` processing requests at once; the others wait for a slot.

Every POST under /api/v1 decodes an image or SVG and runs CPU and memory heavy work in the
thread pool (quantizing a 4096 px photo, building a 3D model). Dozens of them at once
slow every one down and can exhaust the container's memory, so requests beyond the limit
queue, and one that waits longer than `queue_timeout_s` is answered `503 SERVER_BUSY`
with `Retry-After`. Other requests (health checks, limits, CORS preflights) never wait.
The limit holds per worker process. See docs/04-backend.md#concurrency.
"""

import anyio
from starlette.requests import Request
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.errors import ServerBusy, error_response

# Seconds a client is told to wait before trying a busy server again.
RETRY_AFTER_S = 5


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

    async def acquire(self) -> bool:
        """Take a slot, waiting up to `queue_timeout_s`; False when none came free."""
        try:
            # A free slot is taken at once, also with a timeout of 0 (whose cancel scope
            # would stop `acquire` before it looks).
            self._semaphore.acquire_nowait()
            return True
        except anyio.WouldBlock:
            pass
        with anyio.move_on_after(self.queue_timeout_s):
            await self._semaphore.acquire()
            return True
        return False

    def release(self) -> None:
        self._semaphore.release()


class ProcessingLimitMiddleware:
    """Runs each POST request in a processing slot, or answers 503 when none comes free."""

    def __init__(self, app: ASGIApp, slots: ProcessingSlots) -> None:
        self.app = app
        self.slots = slots

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return
        if not await self.slots.acquire():
            busy = ServerBusy(
                f"The server is busy: all {self.slots.limit} processing slots are taken. "
                f"Try again in {RETRY_AFTER_S} seconds.",
                {"max_concurrent_jobs": self.slots.limit, "retry_after_s": RETRY_AFTER_S},
            )
            response = error_response(Request(scope), busy)
            response.headers["Retry-After"] = str(RETRY_AFTER_S)
            await response(scope, receive, send)
            return
        try:
            await self.app(scope, receive, send)
        finally:
            self.slots.release()
