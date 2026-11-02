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


def test_reports_document_statistics(client: TestClient) -> None:
    response = _post(client, "stats", {"speck_area": "150"})

    assert response.status_code == 200
    body = response.json()
    assert (body["width"], body["height"], body["colors"], body["shapes"]) == (40, 20, 3, 3)
    assert body["specks"] == 2
    assert body["layers"][0] == {
        "palette_index": 0,
        "color": "#ffffff",
        "shapes": 1,
        "own_colors": 0,
        "area_px2": 400.0,
        "share": 0.5,
        "specks": 0,
    }


def test_stats_speck_area_is_validated(client: TestClient) -> None:
    response = _post(client, "stats", {"speck_area": "0"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_cuts_a_lasso_region(client: TestClient) -> None:
    response = _post(client, "lasso", {"region": "[[25, 12], [35, 12], [35, 25], [25, 25]]"})

    assert response.status_code == 200
    body = response.json()
    assert (body["cut"], body["inside"], body["outside"]) == (1, ["p-2-0.a"], ["p-2-0.b"])
    assert 'id="p-2-0.a"' in body["svg"]


@pytest.mark.parametrize(
    "form",
    [
        {"region": "[[0, 0], [5, 5]]"},
        {"region": "[[0, 0], [5, 5], [9, 9]]"},  # no area
        {"region": "nope"},
        {"region": "[[0, 0], [5, 0], [0, 5]]", "ids": "[1]"},
    ],
)
def test_lasso_parameters_are_validated(client: TestClient, form: dict[str, str]) -> None:
    response = _post(client, "lasso", form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_PARAMETERS"


def test_transforms_shapes(client: TestClient) -> None:
    response = _post(client, "transform", {"ids": '["p-2-0"]', "dx": "-20", "dy": "-10"})

    assert response.status_code == 200
    body = response.json()
    assert body["transformed"] == ["p-2-0"]
    assert 'd="M0,0 L10,0 L10,10 L0,10 Z"' in body["svg"]


@pytest.mark.parametrize(
    ("form", "code"),
    [
        ({}, "INVALID_PARAMETERS"),  # nothing to do
        ({"scale": "0"}, "VALIDATION_ERROR"),
        ({"rotate": "400"}, "VALIDATION_ERROR"),
        ({"flip": "z"}, "VALIDATION_ERROR"),
        ({"dx": "1", "ids": '["missing"]'}, "INVALID_PARAMETERS"),
    ],
)
def test_transform_parameters_are_validated(
    client: TestClient, form: dict[str, str], code: str
) -> None:
    response = _post(client, "transform", form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


def test_simplifies_outlines(client: TestClient) -> None:
    response = _post(client, "simplify", {"tolerance": "1"})

    assert response.status_code == 200
    body = response.json()
    # Straight squares have nothing to drop.
    assert body["simplified"] == []
    assert body["points_before"] == body["points_after"] == 12


@pytest.mark.parametrize(
    ("form", "code"),
    [
        ({"tolerance": "0"}, "VALIDATION_ERROR"),
        ({"tolerance": "51"}, "VALIDATION_ERROR"),
        ({"ids": "{}"}, "INVALID_PARAMETERS"),
    ],
)
def test_simplify_parameters_are_validated(
    client: TestClient, form: dict[str, str], code: str
) -> None:
    response = _post(client, "simplify", form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


def test_offsets_shapes(client: TestClient) -> None:
    response = _post(client, "offset", {"distance": "-6", "ids": '["p-1-0", "p-2-0"]'})

    assert response.status_code == 200
    body = response.json()
    assert (body["offset"], body["removed"]) == ([], ["p-1-0", "p-2-0"])
    assert body["svg"].count("<path") == 1


@pytest.mark.parametrize(
    ("form", "code"),
    [
        ({}, "VALIDATION_ERROR"),
        ({"distance": "0"}, "INVALID_PARAMETERS"),
        ({"distance": "101"}, "VALIDATION_ERROR"),
        ({"distance": "1", "corners": "bevel"}, "VALIDATION_ERROR"),
        ({"distance": "-50"}, "INVALID_PARAMETERS"),
    ],
)
def test_offset_parameters_are_validated(
    client: TestClient, form: dict[str, str], code: str
) -> None:
    response = _post(client, "offset", form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


def test_crops_the_document(client: TestClient) -> None:
    response = _post(client, "crop", {"padding": "1", "ignore_colors": "[0]"})

    assert response.status_code == 200
    body = response.json()
    # #fefefe at (30, 0)-(40, 10) and red at (20, 10)-(30, 20).
    assert (body["width"], body["height"], body["dx"], body["dy"]) == (22, 22, -19, 1)
    assert 'viewBox="0 0 22 22"' in body["svg"]


@pytest.mark.parametrize(
    ("form", "code"),
    [
        ({"padding": "-1"}, "VALIDATION_ERROR"),
        ({"ignore_colors": "nope"}, "INVALID_PARAMETERS"),
        ({"ignore_colors": "[0, 1, 2]"}, "INVALID_PARAMETERS"),
    ],
)
def test_crop_parameters_are_validated(client: TestClient, form: dict[str, str], code: str) -> None:
    response = _post(client, "crop", form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


def test_reorders_layers(client: TestClient) -> None:
    explicit = _post(client, "reorder", {"order": "[2, 0, 1]"})
    assert explicit.status_code == 200
    assert explicit.json()["order"] == [2, 0, 1]
    assert explicit.json()["svg"].index('id="color-2"') < explicit.json()["svg"].index(
        'id="color-0"'
    )

    assert _post(client, "reorder", {"sort": "dark_to_light"}).json()["order"] == [2, 1, 0]


@pytest.mark.parametrize(
    ("form", "code"),
    [
        ({}, "INVALID_PARAMETERS"),
        ({"order": "[0, 1, 2]", "sort": "largest_first"}, "INVALID_PARAMETERS"),
        ({"order": "[0, 1]"}, "INVALID_PARAMETERS"),
        ({"order": "[0, true, 2]"}, "INVALID_PARAMETERS"),
        ({"sort": "random"}, "VALIDATION_ERROR"),
    ],
)
def test_reorder_parameters_are_validated(
    client: TestClient, form: dict[str, str], code: str
) -> None:
    response = _post(client, "reorder", form)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


def test_fills_holes(client: TestClient) -> None:
    holed = contract_svg(20, 20, [("#000000", ["M0,0 H20 V20 H0 Z M5,5 h2 v2 h-2 z"])])
    response = client.post(
        "/api/v1/svg/fill-holes",
        files={"svg": ("doc.svg", holed, "image/svg+xml")},
        data={"smaller_than": "10"},
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["filled"], body["shapes"]) == (1, ["p-0-0"])
    assert "M 5,5" not in body["svg"]


def test_fill_holes_size_is_validated(client: TestClient) -> None:
    response = _post(client, "fill-holes", {"smaller_than": "0"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_validates_an_svg(client: TestClient) -> None:
    response = _post(client, "validate")

    assert response.status_code == 200
    assert response.json() == {"valid": True, "colors": 3, "shapes": 3, "problems": []}

    broken = client.post(
        "/api/v1/svg/validate", files={"svg": ("doc.svg", b"<html/>", "image/svg+xml")}
    )
    assert broken.status_code == 200
    assert broken.json()["valid"] is False
    assert broken.json()["problems"][0]["code"] == "invalid_svg"
