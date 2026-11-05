import httpx
import pytest
from fastapi.testclient import TestClient

from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg

SVG = contract_svg(
    40,
    20,
    [
        ("#ffffff", ["M0,0 L20,0 L20,20 L0,20 Z"]),
        ("#fefefe", ["M30,0 h10 v10 h-10 z"]),
        ("#ff0000", ["M20,10 h10 v10 h-10 z"]),
    ],
)
RAW = {"Accept": "image/svg+xml"}

# One request per edit router: (path, form).
EDITS = [
    ("merge-similar", {}),
    ("recolor", {"colors": '{"#ff0000": "#00ff00"}'}),
    ("split", {"line": "[[10, -5], [10, 25]]"}),
    ("delete", {"ids": '["p-1-0"]'}),
    ("simplify", {"tolerance": "1"}),
    ("crop", {"padding": "2"}),
    ("batch", {"operations": '[{"op": "delete", "layers": [1]}]'}),
]


def _post(
    client: TestClient, path: str, form: dict[str, str], headers: dict[str, str] | None = None
) -> httpx.Response:
    response: httpx.Response = client.post(
        f"/api/v1/svg/{path}",
        files={"svg": ("doc.svg", SVG, "image/svg+xml")},
        data=form,
        headers=headers,
    )
    return response


@pytest.mark.parametrize(("path", "form"), EDITS)
def test_an_edit_answers_with_the_svg_itself_on_request(
    client: TestClient, path: str, form: dict[str, str]
) -> None:
    raw = _post(client, path, form, RAW)
    envelope = _post(client, path, form)

    assert raw.status_code == 200
    assert raw.headers["content-type"].startswith("image/svg+xml")
    assert raw.text == envelope.json()["svg"]
    parse_svg(raw.content)  # a document the next edit takes


def test_edits_pipe_into_each_other(client: TestClient) -> None:
    deleted = _post(client, "delete", {"layers": "[1]"}, RAW)
    response: httpx.Response = client.post(
        "/api/v1/svg/recolor",
        files={"svg": ("doc.svg", deleted.content, "image/svg+xml")},
        data={"colors": '{"#ffffff": "#000000"}'},
        headers=RAW,
    )

    document = parse_svg(response.content)
    assert [layer.fill for layer in document.layers] == ["#000000", "#ff0000"]


def test_errors_stay_json(client: TestClient) -> None:
    response = _post(client, "delete", {}, RAW)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_PARAMETERS"


@pytest.mark.parametrize("accept", ["application/json", "image/svg+xml, application/json", ""])
def test_json_stays_the_default(client: TestClient, accept: str) -> None:
    response = _post(client, "delete", {"layers": "[1]"}, {"Accept": accept})

    assert response.headers["content-type"] == "application/json"


def test_reports_stay_json(client: TestClient) -> None:
    response = _post(client, "stats", {}, RAW)

    assert response.headers["content-type"] == "application/json"
    assert response.json()["colors"] == 3


def test_the_schema_offers_both(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]

    assert set(paths["/api/v1/svg/delete"]["post"]["responses"]["200"]["content"]) == {
        "application/json",
        "image/svg+xml",
    }
    assert set(paths["/api/v1/svg/stats"]["post"]["responses"]["200"]["content"]) == {
        "application/json"
    }
