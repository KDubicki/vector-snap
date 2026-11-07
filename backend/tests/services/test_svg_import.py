import pytest
from shapely import Point

from app.core.errors import InvalidSvg, SvgTooComplex
from app.services.svg_geometry import VectorDocument, parse_svg, shapes_geometry
from app.services.svg_import import import_svg
from tests.vectors import SVG_NS

MM = 96 / 25.4


def _svg(body: str, attributes: str = 'viewBox="0 0 100 100"') -> bytes:
    return (
        f'<svg xmlns="{SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" {attributes}>'
        f"{body}</svg>"
    ).encode()


def _color_at(document: VectorDocument, x: float, y: float) -> list[str]:
    return [
        layer.fill
        for layer in document.layers
        if shapes_geometry(layer.shapes).contains(Point(x, y))
    ]


def test_reads_shapes_sizes_and_transforms_as_a_browser_draws_them() -> None:
    body = (
        "<defs><style>.brand{fill:#cc0000}</style><path id='t' d='M0 0 H10 V10 H0 Z'/></defs>"
        '<rect width="200" height="100" fill="white"/>'
        '<g transform="translate(20 20) scale(2)"><circle class="brand" cx="10" cy="10" r="5"/></g>'
        '<use xlink:href="#t" x="150" y="50" fill="#123456"/>'
        '<ellipse cx="100" cy="50" rx="20" ry="10" style="fill:rgb(0,128,0)"/>'
    )
    imported = import_svg(_svg(body, 'width="100mm" height="50mm" viewBox="0 0 200 100"'), 100)

    document = imported.document
    assert (document.width, document.height) == pytest.approx((100 * MM, 50 * MM))
    assert [layer.fill for layer in document.layers] == ["#ffffff", "#cc0000", "#123456", "#008000"]
    scale = 100 * MM / 200  # document px per viewBox unit
    assert _color_at(document, 40 * scale, 40 * scale) == ["#cc0000"]
    assert _color_at(document, 155 * scale, 55 * scale) == ["#123456"]
    assert shapes_geometry(document.layers[1].shapes).area == pytest.approx(
        3.14159 * (10 * scale) ** 2, rel=0.01
    )
    # The result is a contract document the other services read.
    assert imported.shapes_read == 4


def test_keeps_only_what_shows_of_shapes_painted_over() -> None:
    body = (
        '<rect width="100" height="100" fill="#ffffff"/>'
        '<circle cx="50" cy="50" r="30" fill="#000000"/>'
        '<circle cx="50" cy="50" r="10" fill="#ffffff"/>'
    )
    document = import_svg(_svg(body), 100).document

    assert [layer.fill for layer in document.layers] == ["#ffffff", "#000000"]
    assert _color_at(document, 50, 50) == ["#ffffff"]
    assert _color_at(document, 50, 25) == ["#000000"]
    # The layers do not overlap: the black ring has a hole where white shows.
    black = shapes_geometry(document.layers[1].shapes)
    assert black.area == pytest.approx(3.14159 * (30**2 - 10**2), rel=0.01)
    assert shapes_geometry(document.layers[0].shapes).intersection(black).area < 0.001 * black.area


@pytest.mark.parametrize(
    ("d", "rule", "hole"),
    [
        ("M10 10 h40 v40 h-40 z M20 20 h20 v20 h-20 z", "evenodd", True),
        ("M10 10 h40 v40 h-40 z M20 20 v20 h20 v-20 z", "nonzero", True),
        ("M10 10 h40 v40 h-40 z M20 20 h20 v20 h-20 z", "nonzero", False),
    ],
)
def test_follows_the_fill_rule(d: str, rule: str, hole: bool) -> None:
    document = import_svg(_svg(f'<path d="{d}" fill="#336699" fill-rule="{rule}"/>'), 100).document

    assert (_color_at(document, 30, 30) == []) == hole
    assert _color_at(document, 12, 12) == ["#336699"]


def test_a_gradient_becomes_the_average_of_its_stops() -> None:
    body = (
        '<defs><linearGradient id="a"><stop offset="0" stop-color="#0000ff"/>'
        '<stop offset="1" style="stop-color:#00ff00"/></linearGradient>'
        '<linearGradient id="b" xlink:href="#a"/></defs>'
        '<rect width="50" height="50" fill="url(#b)"/>'
    )
    imported = import_svg(_svg(body), 100)

    assert [layer.fill for layer in imported.document.layers] == ["#008080"]
    assert imported.ignored == {"gradients": 1}


def test_leaves_out_and_counts_what_the_contract_cannot_hold() -> None:
    body = (
        '<rect width="50" height="50" fill="#ff0000" stroke="#000000"/>'
        '<polyline points="0,90 30,90 30,100" fill="none" stroke="black"/>'
        '<line x1="0" y1="0" x2="10" y2="10" stroke="red"/>'
        '<text x="50" y="80">Hi</text>'
        '<image href="data:image/png;base64,AAAA" width="10" height="10"/>'
        '<rect x="60" width="5" height="5" fill="#00ff00" opacity="0"/>'
        '<rect x="70" width="5" height="5" fill="#00ff00" visibility="hidden"/>'
        '<rect x="80" width="5" height="5" fill="#00ff00" display="none"/>'
    )
    imported = import_svg(_svg(body), 100)

    assert [layer.fill for layer in imported.document.layers] == ["#ff0000"]
    # The stroke around the red square, the polyline and the line: outlines, not areas.
    assert imported.ignored == {"images": 1, "invisible": 2, "strokes": 3, "text": 1}


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"<svg", "well-formed"),
        (b'<html xmlns="http://www.w3.org/1999/xhtml"/>', "not an SVG"),
        (_svg('<path d="M0 0 L10 10" fill="none" stroke="black"/>'), "no filled shapes"),
    ],
)
def test_rejects_documents_without_filled_shapes(data: bytes, message: str) -> None:
    with pytest.raises(InvalidSvg, match=message):
        import_svg(data, 100)


def test_does_not_resolve_entities() -> None:
    data = (
        '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 10 10"><rect width="5" height="5" id="&x;"/></svg>'
    ).encode()

    with pytest.raises(InvalidSvg):
        import_svg(data, 100)


def test_refuses_more_shapes_than_the_limit() -> None:
    body = "".join(f'<rect x="{i * 10}" width="5" height="5" fill="#000"/>' for i in range(5))

    with pytest.raises(SvgTooComplex):
        import_svg(_svg(body), 4)


def test_the_result_is_in_the_contract() -> None:
    from app.services.svg_edit import serialize_svg

    imported = import_svg(_svg('<circle cx="50" cy="50" r="20" fill="#abcdef"/>'), 100)

    reread = parse_svg(serialize_svg(imported.document).encode())
    assert [(layer.palette_index, layer.fill) for layer in reread.layers] == [(0, "#abcdef")]
    assert reread.layers[0].shapes[0].id == "p-0-0"


def test_refuses_a_document_without_size() -> None:
    with pytest.raises(InvalidSvg, match="positive"):
        import_svg(_svg('<rect width="5" height="5"/>', 'viewBox="0 0 0 0"'), 100)


def test_an_opacity_it_cannot_read_shows_the_shape() -> None:
    imported = import_svg(_svg('<rect width="5" height="5" opacity="half"/>'), 100)

    assert [layer.fill for layer in imported.document.layers] == ["#000000"]


def test_refuses_a_result_with_more_shapes_than_the_limit() -> None:
    # Two shapes, but the white bar cuts the black square into two visible pieces.
    body = '<rect width="30" height="10"/><rect x="10" width="10" height="10" fill="#fff"/>'

    with pytest.raises(SvgTooComplex, match="would have 3 shapes"):
        import_svg(_svg(body), 2)
