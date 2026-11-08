import os
import re
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.metrics import CONTENT_TYPE, Histogram, process_lines, route_label
from app.main import create_app
from tests.images import encode, stripes


def _value(text: str, series: str) -> float:
    """The value of one series in the exposition text."""
    match = re.search(rf"^{re.escape(series)} (\S+)$", text, re.MULTILINE)
    assert match, f"{series} not in the metrics"
    return float(match[1])


def test_counts_requests_by_route_and_status() -> None:
    client = TestClient(create_app())
    client.get("/api/v1/health")
    client.get("/api/v1/health")
    client.get("/no/such/page")
    client.post(
        "/api/v1/quantize",
        files={"image": ("a.png", encode(stripes()), "image/png")},
        data={"colors": "3"},
    )

    response = client.get("/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"] == CONTENT_TYPE
    text = response.text
    health = 'method="GET",route="/api/v1/health",status="200"'
    assert _value(text, f"vectorsnap_requests_total{{{health}}}") == 2
    unknown = 'method="GET",route="other",status="404"'
    assert _value(text, f"vectorsnap_requests_total{{{unknown}}}") == 1
    quantize = 'method="POST",route="/api/v1/quantize"'
    assert _value(text, f'vectorsnap_requests_total{{{quantize},status="200"}}') == 1
    assert _value(text, f"vectorsnap_request_duration_seconds_count{{{quantize}}}") == 1
    assert _value(text, f'vectorsnap_request_duration_seconds_bucket{{{quantize},le="+Inf"}}') == 1
    # Only processing requests wait for a slot.
    assert _value(text, "vectorsnap_queue_wait_seconds_count") == 1
    assert _value(text, "vectorsnap_jobs_running") == 0
    assert _value(text, "vectorsnap_jobs_waiting") == 0
    assert _value(text, "vectorsnap_jobs_limit") == 4
    assert _value(text, 'vectorsnap_info{version="0.1.0"}') == 1


def test_reports_the_resources_of_the_process() -> None:
    text = TestClient(create_app()).get("/metrics").text

    assert _value(text, "process_cpu_seconds_total") > 0
    assert 0 < _value(text, "process_start_time_seconds") <= time.time()
    # Python, NumPy, Shapely and the app hold tens of megabytes before any request.
    assert _value(text, "vectorsnap_process_resident_memory_max_bytes") > 10 * 2**20
    assert _value(text, "process_open_fds") > 0
    assert _value(text, "vectorsnap_threads") >= 1
    if Path("/proc/self/statm").exists():  # Linux: the container, CI
        assert _value(text, "process_resident_memory_bytes") > 10 * 2**20


def test_reads_resident_memory_and_open_files_where_linux_tells(tmp_path: Path) -> None:
    (tmp_path / "statm").write_text("5000 1234 300 10 0 900 0\n")
    (tmp_path / "fd").mkdir()
    for descriptor in ("0", "1", "2", "9"):
        (tmp_path / "fd" / descriptor).touch()

    lines = process_lines(tmp_path)

    assert f"process_resident_memory_bytes {1234 * os.sysconf('SC_PAGE_SIZE')}" in lines
    assert "process_open_fds 4" in lines


def test_metrics_are_not_part_of_the_api() -> None:
    client = TestClient(create_app())

    assert "/metrics" not in client.get("/openapi.json").json()["paths"]
    # nginx serves only /api/ from the backend, so browsers never reach it.
    assert client.get("/api/v1/metrics").status_code == 404


def test_histogram_buckets_are_cumulative() -> None:
    histogram = Histogram((0.1, 1.0))
    for value in (0.05, 0.5, 0.7, 5.0):
        histogram.observe(value)

    assert list(histogram.lines("t", {"route": 'a"b'})) == [
        't_bucket{route="a\\"b",le="0.1"} 1',
        't_bucket{route="a\\"b",le="1"} 3',
        't_bucket{route="a\\"b",le="+Inf"} 4',
        't_sum{route="a\\"b"} 6.25',
        't_count{route="a\\"b"} 4',
    ]


@pytest.mark.parametrize(
    ("scope", "label"),
    [
        ({"path": "/api/v1/health", "route": SimpleNamespace(path="/health")}, "/api/v1/health"),
        ({"path": "/api/v1/items/7", "route": SimpleNamespace(path="/items/{id}")}, "/items/{id}"),
        ({"path": "/wp-admin.php"}, "other"),
    ],
)
def test_labels_a_request_by_its_route(scope: dict[str, object], label: str) -> None:
    assert route_label(scope) == label
