import httpx
import pytest
from fastapi.testclient import TestClient

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


def _post(client: TestClient, path: str, form: dict[str, str] | None = None) -> httpx.Response:
    response: httpx.Response = client.post(
        f"/api/v1/svg/{path}", files={"svg": ("doc.svg", SVG, "image/svg+xml")}, data=form or {}
    )
    return response


def test_merges_similar_colors(client: TestClient) -> None:
    response = _post(client, "merge-similar")

    assert response.status_code == 200
    body = response.json()
    assert body["colors"] == 2
    assert body["changes"] == [{"color": "#fefefe", "into": "#ffffff", "delta_e": 0.2}]
    assert "#fefefe" not in body["svg"]


def test_merge_limit_is_validated(client: TestClient) -> None:
    response = _post(client, "merge-similar", {"max_delta_e": "0"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_recolors_to_filaments(client: TestClient) -> None:
    response = _post(
        client,
        "recolor",
        {"colors": '{"#ff0000": "#00ff00"}', "filaments": '["#ffffff", "#00aa00"]'},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["colors"] == 2
    assert [(c["color"], c["into"]) for c in body["changes"]] == [
        ("#fefefe", "#ffffff"),
        ("#ff0000", "#00aa00"),
    ]


@pytest.mark.parametrize(
    "form",
    [
        {},
        {"colors": "[]"},
        {"colors": '{"red": "#ffffff"}'},
        {"filaments": '["#fff"]'},
        {"filaments": "[" + ",".join(['"#ffffff"'] * 129) + "]"},
    ],
)
def test_recolor_rejects_bad_colors(client: TestClient, form: dict[str, str]) -> None:
    response = _post(client, "recolor", form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_PARAMETERS"


def test_splits_shapes_along_a_line(client: TestClient) -> None:
    response = _post(client, "split", {"line": "[[25, 5], [25, 25]]"})

    assert response.status_code == 200
    body = response.json()
    assert body["split"] == 1
    assert body["created"] == ["p-2-0.a", "p-2-0.b"]
    assert 'id="p-2-0.a"' in body["svg"]


def test_splits_only_the_given_shapes(client: TestClient) -> None:
    line = "[[15, 25], [45, -5]]"  # across the red and the #fefefe square
    assert _post(client, "split", {"line": line}).json()["split"] == 2

    response = _post(client, "split", {"line": line, "ids": '["p-1-0"]'})
    assert response.json()["created"] == ["p-1-0.a", "p-1-0.b"]


@pytest.mark.parametrize(
    ("form", "field"),
    [
        ({}, None),
        ({"line": "[[0, 0]]"}, "line"),
        ({"line": "[[0, 0], [0, 0]]"}, "line"),
        ({"line": '[[0, 0], [1, "a"]]'}, "line"),
        ({"line": "[[0, 0], [1, true]]"}, "line"),
        ({"line": "{"}, "line"),
        ({"line": "[[0, 0], [1, 1]]", "ids": "[1]"}, "ids"),
        ({"line": "[[0, 0], [1, 1]]", "ids": "nope"}, "ids"),
    ],
)
def test_split_parameters_are_validated(
    client: TestClient, form: dict[str, str], field: str | None
) -> None:
    response = _post(client, "split", form)

    assert response.status_code == 422
    error = response.json()["error"]
    if field is None:
        assert error["code"] == "VALIDATION_ERROR"
    else:
        assert error["details"]["field"] == field


def test_deletes_shapes(client: TestClient) -> None:
    response = _post(client, "delete", {"ids": '["p-1-0", "missing"]'})

    assert response.status_code == 200
    body = response.json()
    assert body["deleted"] == ["p-1-0"]
    assert body["colors"] == 2
    assert 'id="p-1-0"' not in body["svg"]


def test_deletes_shapes_smaller_than_an_area(client: TestClient) -> None:
    response = _post(client, "delete", {"smaller_than": "150"})

    assert response.json()["deleted"] == ["p-1-0", "p-2-0"]


@pytest.mark.parametrize(
    ("form", "code", "field"),
    [
        ({}, "INVALID_PARAMETERS", "ids"),
        ({"ids": "[]", "smaller_than": "0"}, "INVALID_PARAMETERS", "ids"),
        ({"ids": "[1]"}, "INVALID_PARAMETERS", "ids"),
        ({"smaller_than": "-1"}, "VALIDATION_ERROR", None),
        ({"smaller_than": "1000"}, "INVALID_PARAMETERS", None),  # every shape
    ],
)
def test_delete_parameters_are_validated(
    client: TestClient, form: dict[str, str], code: str, field: str | None
) -> None:
    response = _post(client, "delete", form)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == code
    if field is not None:
        assert error["details"]["field"] == field


def test_merges_shapes(client: TestClient) -> None:
    response = _post(client, "merge", {"ids": '["p-2-0", "p-0-0"]'})

    assert response.status_code == 200
    body = response.json()
    assert (body["id"], body["merged"], body["colors"]) == ("p-0-0", ["p-2-0"], 2)
    assert 'id="p-2-0"' not in body["svg"]


@pytest.mark.parametrize(
    ("form", "code"),
    [
        ({}, "VALIDATION_ERROR"),
        ({"ids": '["p-0-0"]'}, "INVALID_PARAMETERS"),
        ({"ids": '["p-0-0", "missing"]'}, "INVALID_PARAMETERS"),
        ({"ids": "{}"}, "INVALID_PARAMETERS"),
    ],
)
def test_merge_parameters_are_validated(
    client: TestClient, form: dict[str, str], code: str
) -> None:
    response = _post(client, "merge", form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
