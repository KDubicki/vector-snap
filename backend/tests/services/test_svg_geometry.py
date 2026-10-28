import math

import pytest

from app.core.errors import InvalidSvg
from app.services.svg_geometry import curve_path, flatten, parse_svg, polygons, to_polygon
from tests.vectors import SVG_NS, contract_svg

SQUARE = "M0,0 L10,0 L10,10 L0,10 Z"


def test_parses_layers_shapes_and_colors() -> None:
    data = contract_svg(40, 20, [("#FF0000", [SQUARE]), ("#0000ff", ["M20,0 h10 v10 h-10 z"])])

    document = parse_svg(data)

    assert (document.width, document.height) == (40, 20)
    assert [(layer.palette_index, layer.fill) for layer in document.layers] == [
        (0, "#ff0000"),
        (1, "#0000ff"),
    ]
    assert document.layers[1].shapes[0].id == "p-1-0"


def test_shape_fill_overrides_group_fill_and_empty_groups_are_skipped() -> None:
    data = (
        f'<svg xmlns="{SVG_NS}" width="10" height="10">'
        f'<g fill="#111111"><path d="{SQUARE}" fill="#00ff00"/><path d="{SQUARE}"/></g>'
        '<g fill="#222222"><path d=""/></g></svg>'
    ).encode()

    document = parse_svg(data)

    assert len(document.layers) == 1
    assert [shape.fill for shape in document.layers[0].shapes] == ["#00ff00", "#111111"]


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"<svg", "well-formed"),
        (b'<html xmlns="http://www.w3.org/1999/xhtml"/>', "not an SVG"),
        (
            f'<svg xmlns="{SVG_NS}"><g fill="#000000"><path d="M0,0 Z"/></g></svg>'.encode(),
            "viewBox",
        ),
        (f'<svg xmlns="{SVG_NS}" viewBox="0 0 5 5"></svg>'.encode(), "no shapes"),
    ],
)
def test_rejects_invalid_documents(data: bytes, message: str) -> None:
    with pytest.raises(InvalidSvg, match=message):
        parse_svg(data)


def test_does_not_resolve_external_entities() -> None:
    doctype = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
    in_text = (
        doctype + f'<svg xmlns="{SVG_NS}" viewBox="0 0 10 10"><desc>&x;</desc>'
        f'<g fill="#000000"><path d="{SQUARE}"/></g></svg>'
    ).encode()
    in_attribute = (
        doctype + f'<svg xmlns="{SVG_NS}" viewBox="0 0 10 10"><g fill="#000000" id="&x;">'
        f'<path d="{SQUARE}"/></g></svg>'
    ).encode()

    assert parse_svg(in_text).layers[0].shapes[0].d == SQUARE
    with pytest.raises(InvalidSvg):
        parse_svg(in_attribute)


def test_flattens_lines_and_curves_into_closed_rings() -> None:
    rings = flatten("M0,0 L10,0 L10,10 Z M20,0 C25,0 30,5 30,10 L20,10 Z", tolerance=0.5)

    assert len(rings) == 2
    assert rings[0].tolist() == [[0, 0], [10, 0], [10, 10]]
    assert len(rings[1]) > 10  # curve sampled
    assert rings[1][-1].tolist() == [20, 10]


def test_flattens_quadratic_curves_and_arcs() -> None:
    quad = flatten("M0,0 Q10,10 20,0 Z", tolerance=0.5)
    arc = flatten("M0,10 A10,10 0 0 1 20,10 Z", tolerance=0.5)

    assert quad[0][len(quad[0]) // 2] == pytest.approx([10, 5], abs=0.2)  # apex of the curve
    assert len(arc[0]) > 10
    assert to_polygon(arc).area == pytest.approx(math.pi * 100 / 2, rel=0.01)  # half disc


def test_relative_commands_and_tiny_subpaths() -> None:
    rings = flatten("m5,5 h10 v10 h-10 z M0,0 L1,1 Z")

    assert len(rings) == 1
    assert rings[0].tolist() == [[5, 5], [15, 5], [15, 15], [5, 15]]


def test_even_odd_rings_make_holes() -> None:
    geometry = to_polygon(flatten("M0,0 L20,0 L20,20 L0,20 Z M5,5 L5,15 L15,15 L15,5 Z"))

    assert geometry.area == pytest.approx(300)
    assert len(polygons(geometry)) == 1
    assert len(polygons(geometry)[0].interiors) == 1


def test_polygons_flattens_multi_part_geometry() -> None:
    geometry = to_polygon(flatten("M0,0 L5,0 L5,5 Z M10,0 L15,0 L15,5 Z"))

    assert len(polygons(geometry)) == 2
    assert polygons(to_polygon([])) == []


def test_curve_path_keeps_curves_and_converts_quadratics_and_arcs_to_cubic() -> None:
    commands = curve_path("M0,0 l10,0 C10,5 5,10 0,10 Q-6,4 0,0 z M20,0 A5,5 0 0 1 30,0")

    assert [c for c, _ in commands[:6]] == ["M", "L", "C", "C", "Z", "M"]
    assert commands[1][1] == [(10, 0)]
    assert commands[2][1] == [(10, 5), (5, 10), (0, 10)]
    # quadratic (0,10) -> (-6,4) -> (0,0): controls 2/3 of the way to the control point
    # pytest.approx compares flat sequences only (nested ones fail since pytest 9.2)
    flat = [coordinate for point in commands[3][1] for coordinate in point]
    assert flat == pytest.approx([-4, 6, -4, 8 / 3, 0, 0])
    arc = commands[6:]
    assert arc and all(c == "C" for c, _ in arc)
    assert arc[-1][1][-1] == pytest.approx((30, 0))
    assert all(
        math.hypot(x - 25, y) == pytest.approx(5, abs=0.01) for _, p in arc for x, y in p[-1:]
    )
