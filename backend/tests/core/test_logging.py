import json
import logging
import sys

import pytest
from fastapi.testclient import TestClient

from app.core.logging import (
    JsonFormatter,
    RequestIdFilter,
    TextFormatter,
    configure_logging,
    request_id_var,
)
from app.main import create_app


def _record(message: str = "traced %d shapes", *args: object, **extra: object) -> logging.LogRecord:
    record = logging.makeLogRecord(
        {"name": "app.test", "levelno": logging.INFO, "levelname": "INFO", "msg": message}
    )
    record.args = args or (3,)
    record.__dict__.update(extra)
    RequestIdFilter().filter(record)
    return record


def test_json_lines_carry_the_request_id_and_extra_fields() -> None:
    token = request_id_var.set("req-1")
    try:
        entry = json.loads(JsonFormatter().format(_record(decode_ms=12, path="/x")))
    finally:
        request_id_var.reset(token)

    assert entry["message"] == "traced 3 shapes"
    assert (entry["level"], entry["logger"], entry["request_id"]) == ("info", "app.test", "req-1")
    assert (entry["decode_ms"], entry["path"]) == (12, "/x")
    assert entry["time"].endswith("+00:00")


def test_json_lines_include_exceptions() -> None:
    record = _record()
    try:
        raise ValueError("boom")
    except ValueError:
        record.exc_info = sys.exc_info()

    entry = json.loads(JsonFormatter().format(record))

    assert "ValueError: boom" in entry["exception"]
    assert entry["request_id"] == "-"  # logged outside a request


def test_text_lines_show_the_request_id_and_extra_fields_as_key_value() -> None:
    line = TextFormatter().format(_record(trace_ms=40, color_message="\x1b[36m%d\x1b[0m"))

    assert line.endswith("INFO app.test [-] traced 3 shapes trace_ms=40")


def test_text_lines_without_the_filter_still_format() -> None:
    record = logging.makeLogRecord({"name": "app.test", "msg": "plain"})

    assert TextFormatter().format(record).endswith("[-] plain")


def test_configure_replaces_its_own_handler_but_keeps_others() -> None:
    root = logging.getLogger()
    foreign = logging.NullHandler()
    root.addHandler(foreign)
    try:
        configure_logging("debug", json_logs=True)
        configure_logging("info")

        ours = [h for h in root.handlers if getattr(h, "vectorsnap", False)]
        assert len(ours) == 1
        assert isinstance(ours[0].formatter, TextFormatter)
        assert foreign in root.handlers
        assert root.level == logging.INFO
        assert logging.getLogger("uvicorn.access").disabled
        assert logging.getLogger("uvicorn").propagate
    finally:
        root.removeHandler(foreign)


def _access(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == "app.access"]


def test_logs_one_access_line_per_request_with_its_duration(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)

    response = client.post("/api/v1/quantize", headers={"X-Request-ID": "req-42"})

    [record] = _access(caplog)
    assert record.getMessage() == f"POST /api/v1/quantize {response.status_code}"
    assert record.__dict__["status"] == response.status_code == 422
    assert record.__dict__["request_id"] == "req-42"
    assert isinstance(record.__dict__["duration_ms"], int)
    assert request_id_var.get() == "-"  # reset after the request


def test_health_checks_are_logged_at_debug_level(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    client.get("/api/v1/health")
    assert _access(caplog) == []

    caplog.set_level(logging.DEBUG)
    client.get("/api/v1/health")
    assert [r.levelno for r in _access(caplog)] == [logging.DEBUG]


def test_requests_that_crash_are_logged_as_500(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    app = create_app()

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("boom")

    response = TestClient(app, raise_server_exceptions=False).get("/boom")

    assert response.status_code == 500
    assert [r.__dict__["status"] for r in _access(caplog)] == [500]
