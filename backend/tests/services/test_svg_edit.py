import pytest

from app.services.svg_edit import color_delta_e, merge_similar_colors, recolor, serialize_svg
from app.services.svg_geometry import parse_svg
from tests.vectors import SVG_NS, contract_svg

SQUARE = "M0,0 H40 V40 H0 Z"
PATCH = "M50,0 H60 V10 H50 Z"


def test_color_delta_e() -> None:
    assert color_delta_e("#ffffff", "#ffffff") == 0
    assert color_delta_e("#ffffff", "#fefefe") < 1
    assert color_delta_e("#ff0000", "#0000ff") > 50


def test_serialize_round_trips() -> None:
    data = (
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 80 40"><g data-palette-index="3" fill="#ff0000">'
        f'<path id="a" d="{SQUARE}"/><path id="b" d="{PATCH}" fill="#00ff00"/></g></svg>'
    ).encode()
    document = parse_svg(data)
    svg = serialize_svg(document)

    assert parse_svg(svg.encode()) == document
    assert 'id="color-3"' in svg
    assert svg.count('fill="#00ff00"') == 1  # only the shape with its own color


def test_merges_the_smaller_layer_into_the_larger() -> None:
    document = parse_svg(
        contract_svg(80, 40, [("#fefefe", [PATCH]), ("#000000", [SQUARE]), ("#ffffff", [SQUARE])])
    )
    edited = merge_similar_colors(document, 2)

    assert [layer.fill for layer in edited.document.layers] == ["#000000", "#ffffff"]
    assert [shape.id for shape in edited.document.layers[1].shapes] == ["p-2-0", "p-0-0"]
    assert all(shape.fill == "#ffffff" for shape in edited.document.layers[1].shapes)
    assert [(c.color, c.into) for c in edited.changes] == [("#fefefe", "#ffffff")]
    assert edited.changes[0].delta_e == pytest.approx(0.2, abs=0.1)


def test_follows_chains_and_keeps_distinct_colors() -> None:
    document = parse_svg(
        contract_svg(
            80,
            80,
            [
                ("#808080", ["M0,0 H10 V10 H0 Z"]),
                ("#828282", ["M0,0 H20 V20 H0 Z"]),
                ("#858585", ["M0,0 H50 V50 H0 Z"]),
                ("#ff0000", [PATCH]),
            ],
        )
    )
    edited = merge_similar_colors(document, 2)

    assert [layer.fill for layer in edited.document.layers] == ["#858585", "#ff0000"]
    assert {c.color: c.into for c in edited.changes} == {"#808080": "#858585", "#828282": "#858585"}


def test_own_colors_like_their_layer_follow_it() -> None:
    data = (
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 80 40"><g data-palette-index="0" fill="#ff0000">'
        f'<path id="a" d="{SQUARE}"/><path id="b" d="{PATCH}" fill="#fe0101"/>'
        f'<path id="c" d="{PATCH}" fill="#0000ff"/></g></svg>'
    ).encode()
    edited = merge_similar_colors(parse_svg(data), 2)

    assert [shape.fill for shape in edited.document.layers[0].shapes] == [
        "#ff0000",
        "#ff0000",
        "#0000ff",
    ]
    assert [(c.color, c.into) for c in edited.changes] == [("#fe0101", "#ff0000")]


def test_nothing_to_merge() -> None:
    document = parse_svg(contract_svg(80, 40, [("#000000", [SQUARE]), ("#ffffff", [PATCH])]))

    assert merge_similar_colors(document, 2).document == document
    assert merge_similar_colors(document, 0).changes == []


def test_recolor_replaces_colors_and_joins_equal_layers() -> None:
    document = parse_svg(
        contract_svg(80, 40, [("#ffffff", [SQUARE]), ("#808080", [PATCH]), ("#ff0000", [PATCH])])
    )
    edited = recolor(document, {"#808080": "#FFFFFF"})

    assert [layer.fill for layer in edited.document.layers] == ["#ffffff", "#ff0000"]
    assert [shape.id for shape in edited.document.layers[0].shapes] == ["p-0-0", "p-1-0"]
    assert [(c.color, c.into) for c in edited.changes] == [("#808080", "#ffffff")]


def test_recolor_keeps_the_larger_of_joined_layers() -> None:
    document = parse_svg(contract_svg(80, 40, [("#000000", [PATCH]), ("#ffffff", [SQUARE])]))
    edited = recolor(document, {"#000000": "#ffffff"})

    assert [shape.id for shape in edited.document.layers[0].shapes] == ["p-1-0", "p-0-0"]


def test_recolor_snaps_to_the_closest_filaments() -> None:
    data = (
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 80 40"><g data-palette-index="0" fill="#f0f0f0">'
        f'<path id="a" d="{SQUARE}"/><path id="b" d="{PATCH}" fill="#202020"/></g>'
        f'<g data-palette-index="1" fill="#d01010"><path id="c" d="{PATCH}"/></g>'
        f'<g data-palette-index="2" fill="#123456"><path id="d" d="{PATCH}"/></g></svg>'
    ).encode()
    edited = recolor(parse_svg(data), {"#123456": "#ffffff"}, ["#FFFFFF", "#000000", "#ff0000"])

    layers = edited.document.layers
    assert [layer.fill for layer in layers] == ["#ffffff", "#ff0000"]
    assert [shape.fill for shape in layers[0].shapes] == ["#ffffff", "#000000", "#ffffff"]
    assert {c.color: c.into for c in edited.changes} == {
        "#f0f0f0": "#ffffff",
        "#202020": "#000000",
        "#d01010": "#ff0000",
        "#123456": "#ffffff",
    }
