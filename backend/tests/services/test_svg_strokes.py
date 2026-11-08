import pytest
from shapely import Point

from app.core.errors import SvgTooComplex
from app.services.svg_geometry import VectorDocument, shapes_geometry
from app.services.svg_import import import_svg
from app.services.svg_strokes import dash_pattern
from tests.vectors import SVG_NS


def _import(
    body: str, attributes: str = 'viewBox="0 0 100 100"', limit: int = 1000
) -> VectorDocument:
    svg = f'<svg xmlns="{SVG_NS}" {attributes}>{body}</svg>'.encode()
    return import_svg(svg, limit).document


def _color_at(document: VectorDocument, x: float, y: float) -> list[str]:
    return [
        layer.fill
        for layer in document.layers
        if shapes_geometry(layer.shapes).contains(Point(x, y))
    ]


def test_an_icon_drawn_with_strokes_becomes_the_area_they_paint() -> None:
    # Lucide's house: fill="none", a 2 px pen with round caps and joins.
    icon = (
        '<g fill="none" stroke="#123456" stroke-width="2" stroke-linecap="round" '
        'stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
        '<polyline points="9 22 9 12 15 12 15 22"/></g>'
    )
    document = _import(icon, 'viewBox="0 0 24 24"')

    assert [layer.fill for layer in document.layers] == ["#123456"]
    assert _color_at(document, 3.9, 15) == ["#123456"]  # within 1 of the wall at x = 3
    assert _color_at(document, 4.1, 15) == []  # the inside stays empty
    assert _color_at(document, 12, 12.9) == ["#123456"]  # the door's lintel
    assert _color_at(document, 12, 14) == []


@pytest.mark.parametrize(
    ("cap", "beyond_the_end", "corner"),
    [("butt", [], []), ("round", ["#ff0000"], []), ("square", ["#ff0000"], ["#ff0000"])],
)
def test_line_caps(cap: str, beyond_the_end: list[str], corner: list[str]) -> None:
    line = (
        '<line x1="10" y1="50" x2="90" y2="50" stroke="red" stroke-width="10" '
        f'stroke-linecap="{cap}"/>'
    )
    document = _import(line)

    assert _color_at(document, 50, 54) == ["#ff0000"]
    assert _color_at(document, 7, 50) == beyond_the_end
    assert _color_at(document, 6, 46) == corner  # 5.7 from the end: outside a round cap


@pytest.mark.parametrize(
    ("join", "limit", "tip"),
    [
        ("miter", "4", ["#0000ff"]),
        ("miter", "1", []),  # a right angle's miter is 1.41 widths long: beveled
        ("bevel", "4", []),
        ("round", "4", []),
    ],
)
def test_line_joins(join: str, limit: str, tip: list[str]) -> None:
    corner = (
        '<polyline points="10,10 50,10 50,50" fill="none" stroke="blue" stroke-width="10" '
        f'stroke-linejoin="{join}" stroke-miterlimit="{limit}"/>'
    )
    document = _import(corner)

    assert _color_at(document, 54, 6) == tip  # 5.7 from the corner, in the miter's tip
    assert _color_at(document, 52, 8) == ["#0000ff"]  # 2.8 from it: every join


def test_a_closed_path_joins_where_it_starts() -> None:
    square = (
        '<rect x="20" y="20" width="60" height="60" fill="none" stroke="black" stroke-width="10"/>'
    )
    document = _import(square)

    assert _color_at(document, 16, 16) == ["#000000"]  # the corner at the start is mitred too
    assert _color_at(document, 50, 50) == []


def test_dashes_dots_and_their_offset() -> None:
    body = (
        '<line x1="0" y1="10" x2="100" y2="10" stroke="red" stroke-width="4" '
        'stroke-dasharray="10" stroke-dashoffset="5"/>'
        '<line x1="0" y1="30" x2="100" y2="30" stroke="blue" stroke-width="2" '
        'stroke-dasharray="0, 10" stroke-linecap="round"/>'
    )
    document = _import(body)

    # "10" repeats as 10 on, 10 off; started 5 into it, the first dash ends at 5.
    assert _color_at(document, 3, 10) == ["#ff0000"]
    assert _color_at(document, 10, 10) == []
    assert _color_at(document, 20, 10) == ["#ff0000"]
    # Dashes of no length with round caps: dots every 10.
    assert _color_at(document, 10, 30) == ["#0000ff"]
    assert _color_at(document, 15, 30) == []
    blue = next(layer for layer in document.layers if layer.fill == "#0000ff")
    assert len(blue.shapes) == 11


@pytest.mark.parametrize(
    ("value", "pattern"),
    [
        ("none", None),
        ("", None),
        ("5 -1", None),  # SVG draws a negative length solid
        ("0 0", None),
        ("4%", None),
        ("3", [6.0, 6.0]),
        ("1, 2 3", [2.0, 4.0, 6.0, 2.0, 4.0, 6.0]),
        ("2px 1", [4.0, 2.0]),
    ],
)
def test_dash_pattern(value: str, pattern: list[float] | None) -> None:
    assert dash_pattern(value, 2.0) == pattern


def test_a_stroke_scales_with_its_element_unless_it_keeps_its_width() -> None:
    body = (
        '<g transform="scale(2)"><line x1="5" y1="10" x2="45" y2="10" stroke="red" '
        'stroke-width="2" stroke-dasharray="5"/>'
        '<line x1="5" y1="30" x2="45" y2="30" stroke="blue" stroke-width="2" '
        'vector-effect="non-scaling-stroke"/></g>'
    )
    # The viewBox doubles too: the red pen is 2 * 2 * 2 = 8 px wide, its dashes 20 px.
    document = _import(body, 'width="200" height="200" viewBox="0 0 100 100"')

    assert _color_at(document, 30, 43.9) == ["#ff0000"]
    assert _color_at(document, 30, 36.1) == ["#ff0000"]
    assert _color_at(document, 30, 35.9) == []
    assert _color_at(document, 50, 40) == []  # the first gap: 40 to 60
    assert _color_at(document, 100, 120.9) == ["#0000ff"]  # 2 px wide on the page
    assert _color_at(document, 100, 121.1) == []


def test_the_stroke_is_painted_over_the_fill_unless_paint_order_says_otherwise() -> None:
    body = (
        '<rect x="10" y="10" width="30" height="30" fill="yellow" stroke="black" stroke-width="6"/>'
        '<rect x="60" y="10" width="30" height="30" fill="yellow" stroke="black" stroke-width="6" '
        'paint-order="stroke fill"/>'
    )
    document = _import(body)

    assert _color_at(document, 12, 25) == ["#000000"]  # over the fill's edge
    assert _color_at(document, 62, 25) == ["#ffff00"]  # under it
    assert _color_at(document, 58, 25) == ["#000000"]


def test_a_gradient_stroke_is_its_average_color() -> None:
    body = (
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/>'
        '<stop offset="1" stop-color="#0000ff"/></linearGradient></defs>'
        '<line x1="10" y1="50" x2="90" y2="50" stroke="url(#g)" stroke-width="4"/>'
    )
    svg = f'<svg xmlns="{SVG_NS}" viewBox="0 0 100 100">{body}</svg>'.encode()

    imported = import_svg(svg, 100)

    assert [layer.fill for layer in imported.document.layers] == ["#800080"]
    assert imported.ignored == {"gradients": 1}


def test_refuses_more_dashes_than_shapes_it_accepts() -> None:
    line = '<line x1="0" y1="50" x2="100" y2="50" stroke="red" stroke-dasharray="0.01"/>'

    with pytest.raises(SvgTooComplex, match="dashes"):
        _import(line, limit=1000)
