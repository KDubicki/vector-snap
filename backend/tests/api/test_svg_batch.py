import json

import httpx
import pytest
from fastapi.testclient import TestClient

from tests.vectors import contract_svg

# 40 x 20: a white background, a #fefefe square, a red square and a 1 x 1 red speck.
SVG = contract_svg(
    40,
    20,
    [
        ("#ffffff", ["M0,0 L20,0 L20,20 L0,20 Z"]),
        ("#fefefe", ["M30,0 h10 v10 h-10 z"]),
        ("#ff0000", ["M20,10 h10 v10 h-10 z", "M35,15 h1 v1 h-1 z"]),
    ],
)


def _batch(client: TestClient, steps: object) -> httpx.Response:
    response: httpx.Response = client.post(
        "/api/v1/svg/batch",
        files={"svg": ("doc.svg", SVG, "image/svg+xml")},
        data={"operations": json.dumps(steps)},
    )
    return response


def test_runs_every_step_on_the_previous_result(client: TestClient) -> None:
    response = _batch(
        client,
        [
            {"op": "delete", "smaller_than": 5},
            {"op": "merge_similar"},
            {"op": "recolor", "colors": {"#ff0000": "#00ff00"}},
            {"op": "offset", "distance": 1, "corners": "sharp", "ids": ["p-2-0"]},
            {"op": "simplify", "tolerance": 1},
            {"op": "fill_holes", "smaller_than": 10},
            {"op": "transform", "dx": 1},
            {"op": "reorder", "sort": "largest_first"},
            {"op": "crop", "padding": 2},
        ],
    )

    assert response.status_code == 200
    body = response.json()
    assert [(step["op"], step["changed"]) for step in body["steps"]] == [
        ("delete", 1),
        ("merge_similar", 1),
        ("recolor", 1),
        ("offset", 1),
        ("simplify", 0),
        ("fill_holes", 0),
        ("transform", 3),
        ("reorder", 0),
        ("crop", 3),
    ]
    assert "#fefefe" not in body["svg"] and "#00ff00" in body["svg"]
    assert 'id="p-2-1"' not in body["svg"]


@pytest.mark.parametrize(
    ("steps", "message"),
    [
        ("not json", "operations"),
        ([], "operations"),
        ([{"op": "explode"}], "operations"),
        ([{"op": "simplify", "tolerance": 0}], "operations"),
        ([{"op": "delete", "smaller_than": 1, "extra": 1}], "operations"),
        ([{"op": "simplify"}, {"op": "delete"}], "Step 2 (delete)"),
        ([{"op": "offset", "distance": 0}], "Step 1 (offset)"),
        ([{"op": "reorder"}], "Step 1 (reorder)"),
        ([{"op": "offset", "distance": -50}], "Step 1 (offset)"),
    ],
)
def test_bad_steps_are_named(client: TestClient, steps: object, message: str) -> None:
    response = client.post(
        "/api/v1/svg/batch",
        files={"svg": ("doc.svg", SVG, "image/svg+xml")},
        data={"operations": steps if isinstance(steps, str) else json.dumps(steps)},
    )

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "INVALID_PARAMETERS"
    assert message in (error["details"].get("field", "") + error["message"])


def test_a_failing_step_reports_its_position(client: TestClient) -> None:
    error = _batch(client, [{"op": "merge_similar"}, {"op": "offset", "distance": -50}]).json()

    assert error["error"]["details"]["step"] == 1
    assert error["error"]["details"]["field"] == "distance"
