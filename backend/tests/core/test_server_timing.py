import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.logging import record_timing, server_timing, step_timings_var
from tests.images import encode, stripes

IMAGE = encode(stripes())


def _timings(response: httpx.Response) -> dict[str, float]:
    """`Server-Timing` as {name: ms}, in header order."""
    timings = {}
    for metric in response.headers["Server-Timing"].split(","):
        name, duration = metric.strip().split(";")
        timings[name] = float(duration.removeprefix("dur="))
    return timings


def test_quantizing_reports_its_steps(client: TestClient) -> None:
    response = client.post(
        "/api/v1/quantize", files={"image": ("i.png", IMAGE, "image/png")}, data={"colors": "3"}
    )

    assert response.status_code == 200
    timings = _timings(response)
    assert list(timings) == ["queue", "decode", "quantize", "total"]
    assert all(ms >= 0 for ms in timings.values())


def test_one_shot_vectorizing_reports_quantizing_and_tracing(client: TestClient) -> None:
    response = client.post(
        "/api/v1/vectorize", files={"image": ("i.png", IMAGE, "image/png")}, data={"colors": "3"}
    )

    assert response.status_code == 200
    assert list(_timings(response)) == ["queue", "decode", "quantize", "trace", "total"]


def test_a_request_without_steps_reports_its_total(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert list(_timings(response)) == ["total"]


def test_the_queue_wait_is_logged(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)

    client.post("/api/v1/quantize")

    [record] = [r for r in caplog.records if r.name == "app.access"]
    assert isinstance(record.__dict__["queue_ms"], int)


def test_timings_outside_a_request_are_dropped() -> None:
    record_timing("decode", 5)  # no request: nothing to report to, nothing raised

    assert step_timings_var.get() is None
    assert server_timing({"decode": 4.04}, 12.345) == "decode;dur=4.0, total;dur=12.3"
