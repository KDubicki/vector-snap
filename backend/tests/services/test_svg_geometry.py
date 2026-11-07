import math

import pytest

from app.core.errors import InvalidSvg
from app.services.svg_geometry import (
    MAX_CURVE_SAMPLES,
    curve_path,
    flatten,
    parse_svg,
    polygons,
    shape_outline,
    to_polygon,
)
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


def _sized(attributes: str, d: str = SQUARE, group: str = 'fill="#000000"') -> bytes:
    return f'<svg xmlns="{SVG_NS}" {attributes}><g {group}><path d="{d}"/></g></svg>'.encode()


@pytest.mark.parametrize(
    ("width", "height", "expected"),
    [
        ("200", "100", (200, 100)),
        ("200px", " 100px ", (200, 100)),
        ("25.4mm", "2.54cm", (96, 96)),
        ("1in", "72pt", (96, 96)),
        ("6pc", "1e1Q", (96, 96 / 101.6 * 10)),
    ],
)
def test_reads_a_size_in_absolute_units_without_a_viewbox(
    width: str, height: str, expected: tuple[float, float]
) -> None:
    document = parse_svg(_sized(f'width="{width}" height="{height}"'))

    assert (document.width, document.height) == pytest.approx(expected)


def test_a_viewbox_wins_over_a_relative_size() -> None:
    document = parse_svg(_sized('width="100%" height="100%" viewBox="0 0 20 10"'))

    assert (document.width, document.height) == (20, 10)


@pytest.mark.parametrize(
    ("attributes", "message"),
    [
        ('width="100%" height="100%"', "not a length"),
        ('width="10em" height="10"', "not a length"),
        ('width="2e7" height="10"', "beyond 10,000,000 px"),
        ('viewBox="0 0 a b"', "not four numbers"),
        ('viewBox="0 0 10"', "not four numbers"),
        ('viewBox="0 0 nan 10"', "not four numbers"),
        ('viewBox="0 0 1e999 10"', "not four numbers"),
        ('viewBox="0 0 -10 10"', "positive"),
    ],
)
def test_rejects_sizes_it_cannot_read(attributes: str, message: str) -> None:
    with pytest.raises(InvalidSvg, match=message):
        parse_svg(_sized(attributes))


def test_moves_the_shapes_of_a_viewbox_not_at_the_origin() -> None:
    document = parse_svg(_sized('viewBox="-10 -5 20 10"', d="m-10,-5 h10 v10 h-10 z"))

    assert (document.width, document.height) == (20, 10)
    assert shape_outline(document.layers[0].shapes[0]).bounds == pytest.approx((0, 0, 10, 10))


def test_a_palette_index_that_is_not_a_number_is_the_group_position() -> None:
    document = parse_svg(_sized('viewBox="0 0 10 10"', group='data-palette-index="red"'))

    assert document.layers[0].palette_index == 0


@pytest.mark.parametrize(
    ("d", "message"),
    [
        ("M0,0 Q", "cannot be read"),
        ("M0,0 L5", "cannot be read"),
        ("M nan,0 L1,1 Z", "cannot be read"),
        ("M0,0 L1e999,0 L5,5 Z", "beyond 10,000,000 px"),
        ("M0,0 C0,0 2e7,0 5,5 Z", "beyond 10,000,000 px"),
    ],
)
def test_path_data_it_cannot_read_is_an_invalid_svg(d: str, message: str) -> None:
    with pytest.raises(InvalidSvg, match=message):
        flatten(d)
    with pytest.raises(InvalidSvg, match=message):
        curve_path(d)


def test_samples_a_very_long_curve_with_a_bounded_number_of_points() -> None:
    (ring,) = flatten("M0,0 C0,1000000 1000000,1000000 1000000,0 Z")

    assert len(ring) <= MAX_CURVE_SAMPLES + 1


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
