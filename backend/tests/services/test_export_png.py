import io

import pytest
from PIL import Image

from app.services.export_png import PngOptions, export_png
from app.services.svg_geometry import VectorDocument, parse_svg
from tests.vectors import SVG_NS, contract_svg

DOCUMENT = parse_svg(
    contract_svg(
        40,
        20,
        [
            ("#000000", ["M0,0 H20 V20 H0 Z M5,5 V15 H15 V5 Z"]),  # square with a hole
            ("#ff0000", ["M30,0 h10 v10 h-10 z"]),
        ],
    )
)


def _render(options: PngOptions, document: VectorDocument = DOCUMENT) -> Image.Image:
    return Image.open(io.BytesIO(export_png(document, options)))


def test_renders_layers_in_their_colors() -> None:
    image = _render(PngOptions(width_px=400))

    assert image.size == (400, 200)
    assert image.mode == "RGBA"
    assert image.getpixel((20, 20)) == (0, 0, 0, 255)
    assert image.getpixel((100, 100)) == (0, 0, 0, 0)  # the hole
    assert image.getpixel((350, 50)) == (255, 0, 0, 255)
    assert image.getpixel((350, 150)) == (0, 0, 0, 0)
    assert image.info["dpi"] == pytest.approx((300, 300), abs=0.1)


def test_background_and_dpi() -> None:
    image = _render(PngOptions(width_px=40, background="#00ff00", dpi=600))

    assert image.getpixel((10, 10)) == (0, 255, 0, 255)  # the hole shows the background
    assert image.info["dpi"] == pytest.approx((600, 600), abs=0.1)


def test_edges_are_smooth() -> None:
    circle = parse_svg(
        contract_svg(20, 20, [("#000000", ["M0,10 A10,10 0 1,0 20,10 A10,10 0 1,0 0,10 Z"])])
    )
    alphas = set(_render(PngOptions(width_px=200), circle).getchannel("A").tobytes())

    assert {0, 255} < alphas  # partly covered pixels along the edge


def test_own_shape_colors_and_large_images() -> None:
    data = (
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 10 10"><g data-palette-index="0" fill="#000000">'
        '<path d="M0,0 H10 V10 H0 Z" fill="#0000ff"/></g></svg>'
    ).encode()
    image = _render(PngOptions(width_px=4096), parse_svg(data))

    assert image.size == (4096, 4096)
    assert image.getpixel((2000, 2000)) == (0, 0, 255, 255)
