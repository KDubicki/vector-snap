import httpx
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
