"""Prometheus metrics of one worker process, served by `GET /metrics` in the text format.

`request_id_middleware` (app/core/logging.py) reports every request: its route, status,
duration and time waiting for a processing slot. The processing load (running, waiting,
limit) is read from `ProcessingSlots` when scraped. Counters live in the process, as the
readiness probe's load does: run one worker per container and scrape each container.
Written by hand, so the service needs no client library. See
docs/04-backend.md#observability.
"""

import math
from collections import Counter
from collections.abc import Iterable
from typing import TYPE_CHECKING

from starlette.types import Scope

if TYPE_CHECKING:  # concurrency imports logging, which imports this module
    from app.core.concurrency import ProcessingSlots

CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"
# Seconds: health checks and limits take milliseconds, a 4096 px trace or a large 3MF
# tens of seconds, up to the proxy timeout of 120 s.
DURATION_BUCKETS = (0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0)
QUEUE_BUCKETS = (0.01, 0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0)
# Route label of requests no route answered: unknown paths (404), CORS preflights (the
# CORS middleware answers them), and processing requests refused before routing (413
# over the upload limit, 503 busy, 499 client left). Their paths would make a series each.
OTHER = "other"


def route_label(scope: Scope) -> str:
    """The route a request reached, as a label: its path when a route matched (none
    has path parameters, so there are as many as routes), its template if one has,
    `other` otherwise. FastAPI's matched route knows only its path within the router it
    was declared on (`/health`), not the prefixes before it."""
    route = scope.get("route")
    if route is None:
        return OTHER
    template = str(getattr(route, "path", ""))
    return template if "{" in template else str(scope["path"])


class Histogram:
    def __init__(self, buckets: tuple[float, ...]) -> None:
        self.buckets = buckets
        self.counts = [0] * len(buckets)  # per bucket, not cumulative
        self.sum = 0.0
        self.count = 0

    def observe(self, value: float) -> None:
        for index, bound in enumerate(self.buckets):
            if value <= bound:
                self.counts[index] += 1
                break
        self.sum += value
        self.count += 1

    def lines(self, name: str, labels: dict[str, str]) -> Iterable[str]:
        cumulative = 0
        for bound, count in zip(self.buckets, self.counts, strict=True):
            cumulative += count
            yield f"{name}_bucket{_labels({**labels, 'le': _number(bound)})} {cumulative}"
        yield f"{name}_bucket{_labels({**labels, 'le': '+Inf'})} {self.count}"
        yield f"{name}_sum{_labels(labels)} {_number(self.sum)}"
        yield f"{name}_count{_labels(labels)} {self.count}"


def _number(value: float) -> str:
    if math.isinf(value):
        return "+Inf"
    return repr(float(value)) if value != int(value) else str(int(value))


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _labels(labels: dict[str, str]) -> str:
    if not labels:
        return ""
    return "{" + ",".join(f'{key}="{_escape(value)}"' for key, value in labels.items()) + "}"


class Metrics:
    """What one worker process served. Updated on the event loop only, so without locks."""

    def __init__(self) -> None:
        self.requests: Counter[tuple[str, str, int]] = Counter()
        self.durations: dict[tuple[str, str], Histogram] = {}
        self.queue = Histogram(QUEUE_BUCKETS)

    def observe(
        self, method: str, route: str, status: int, seconds: float, queue_s: float | None
    ) -> None:
        self.requests[(method, route, status)] += 1
        key = (method, route)
        if key not in self.durations:
            self.durations[key] = Histogram(DURATION_BUCKETS)
        self.durations[key].observe(seconds)
        if queue_s is not None:
            self.queue.observe(queue_s)

    def render(self, slots: "ProcessingSlots", version: str) -> str:
        lines = [
            "# HELP vectorsnap_info The running version.",
            "# TYPE vectorsnap_info gauge",
            f"vectorsnap_info{_labels({'version': version})} 1",
            "# HELP vectorsnap_requests_total Requests answered, by route and status "
            "(503: no processing slot came free in time; 499: the client left while waiting).",
            "# TYPE vectorsnap_requests_total counter",
        ]
        for (method, route, status), count in sorted(self.requests.items()):
            labels = {"method": method, "route": route, "status": str(status)}
            lines.append(f"vectorsnap_requests_total{_labels(labels)} {count}")
        lines += [
            "# HELP vectorsnap_request_duration_seconds Time to answer a request.",
            "# TYPE vectorsnap_request_duration_seconds histogram",
        ]
        for (method, route), histogram in sorted(self.durations.items()):
            labels = {"method": method, "route": route}
            lines.extend(histogram.lines("vectorsnap_request_duration_seconds", labels))
        lines += [
            "# HELP vectorsnap_queue_wait_seconds Time processing requests waited for a slot.",
            "# TYPE vectorsnap_queue_wait_seconds histogram",
            *self.queue.lines("vectorsnap_queue_wait_seconds", {}),
            "# HELP vectorsnap_jobs_running Processing requests holding a slot.",
            "# TYPE vectorsnap_jobs_running gauge",
            f"vectorsnap_jobs_running {slots.busy}",
            "# HELP vectorsnap_jobs_waiting Processing requests waiting for a slot.",
            "# TYPE vectorsnap_jobs_waiting gauge",
            f"vectorsnap_jobs_waiting {slots.waiting}",
            "# HELP vectorsnap_jobs_limit Processing slots (VECTORSNAP_MAX_CONCURRENT_JOBS).",
            "# TYPE vectorsnap_jobs_limit gauge",
            f"vectorsnap_jobs_limit {slots.limit}",
        ]
        return "\n".join(lines) + "\n"
