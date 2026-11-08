"""Logging setup: request ids on every line, JSON in production, one access line per request.

Extra fields (`logger.info("...", extra={"decode_ms": 12})`) become JSON keys in
production and `key=value` pairs in development. See docs/04-backend.md#observability.
"""

import json
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from fastapi import Request, Response

from app.core.metrics import Metrics, route_label

REQUEST_ID_HEADER = "X-Request-ID"
HEALTH_PREFIX = "/api/v1/health"
# An incoming X-Request-ID is kept when it looks like an id a proxy or client makes
# (nginx's 32 hex digits, a UUID, a trace id). Anything else (spaces, quotes,
# `key=value` lookalikes, kilobytes) would land verbatim in every log line.
REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9._:-]{1,128}")

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
# Durations (ms) of the steps of the request being handled, by name, for its
# Server-Timing header; None outside a request.
step_timings_var: ContextVar[dict[str, float] | None] = ContextVar("step_timings", default=None)
access_logger = logging.getLogger("app.access")

# Attributes every LogRecord has; anything else was passed through `extra`
# (uvicorn's `color_message` is its message with terminal colors).
_RECORD_ATTRS = set(vars(logging.makeLogRecord({}))) | {
    "message",
    "asctime",
    "request_id",
    "color_message",
}


def _extra(record: logging.LogRecord) -> dict[str, Any]:
    return {k: v for k, v in vars(record).items() if k not in _RECORD_ATTRS}


class RequestIdFilter(logging.Filter):
    """Adds the id of the request being handled (or "-") to every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line, for log collectors."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
            **_extra(record),
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


class TextFormatter(logging.Formatter):
    """Human-readable lines with the request id and extra fields as key=value."""

    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        line = super().format(record)
        fields = " ".join(f"{k}={v}" for k, v in _extra(record).items())
        return f"{line} {fields}" if fields else line


def configure_logging(level: str, *, json_logs: bool = False) -> None:
    """Send app and server logs through one handler on the root logger.

    Replaces the handler installed by an earlier call (e.g. another `create_app`), but
    keeps foreign handlers such as pytest's log capture.
    """
    root = logging.getLogger()
    for handler in [h for h in root.handlers if getattr(h, "vectorsnap", False)]:
        root.removeHandler(handler)
    handler = logging.StreamHandler()
    handler.vectorsnap = True  # type: ignore[attr-defined]
    handler.addFilter(RequestIdFilter())
    handler.setFormatter(JsonFormatter() if json_logs else TextFormatter())
    root.addHandler(handler)
    root.setLevel(level.upper())
    # uvicorn logs through its own handlers; route them through ours instead and drop its
    # access log, which the middleware below replaces (with request ids and durations).
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers.clear()
        logging.getLogger(name).propagate = True
    logging.getLogger("uvicorn.access").disabled = True


def record_timing(step: str, ms: float) -> None:
    """Report how long a step of the request took, in its Server-Timing header (a
    no-op outside a request). Worker threads share the request's dict: the thread
    pool runs them in a copy of its context."""
    timings = step_timings_var.get()
    if timings is not None:
        timings[step] = ms


def server_timing(timings: dict[str, float], total_ms: float) -> str:
    """`Server-Timing` value: each step, then the whole request (`total`)."""
    steps = [*timings.items(), ("total", total_ms)]
    return ", ".join(f"{name};dur={ms:.1f}" for name, ms in steps)


def request_id_of(request: Request) -> str:
    """The client's request id when it is well-formed, otherwise a new UUID."""
    incoming = request.headers.get(REQUEST_ID_HEADER, "")
    return incoming if REQUEST_ID_PATTERN.fullmatch(incoming) else str(uuid.uuid4())


async def request_id_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    request_id = request_id_of(request)
    request.state.request_id = request_id
    token = request_id_var.set(request_id)
    timings: dict[str, float] = {}
    timings_token = step_timings_var.set(timings)
    started = time.perf_counter()
    status = 500  # unless a response comes back
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers[REQUEST_ID_HEADER] = request_id
        response.headers["Server-Timing"] = server_timing(
            timings, (time.perf_counter() - started) * 1000
        )
        return response
    finally:
        elapsed = time.perf_counter() - started
        # Set by error_body() when the answer is an error envelope.
        error: str | None = getattr(request.state, "error_code", None)
        metrics: Metrics | None = getattr(request.app.state, "metrics", None)
        if metrics is not None:
            metrics_route = route_label(request.scope)
            queue_s = timings["queue"] / 1000 if "queue" in timings else None
            # The queue has a histogram of its own; the rest are processing steps.
            steps = {step: ms / 1000 for step, ms in timings.items() if step != "queue"}
            metrics.observe(
                request.method, metrics_route, status, elapsed, queue_s, error=error, steps=steps
            )
        # Health checks run every few seconds; keep them out of normal logs.
        level = logging.DEBUG if request.url.path.startswith(HEALTH_PREFIX) else logging.INFO
        access_logger.log(
            level,
            "%s %s %d",
            request.method,
            request.url.path,
            status,
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": status,
                "duration_ms": round(elapsed * 1000),
                **({"queue_ms": round(timings["queue"])} if "queue" in timings else {}),
                **({"error": error} if error else {}),
            },
        )
        step_timings_var.reset(timings_token)
        request_id_var.reset(token)
