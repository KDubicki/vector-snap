import json
import struct

import pytest

from app.services.export_palette import export_palette, palette_colors
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg

DOCUMENT = parse_svg(
    contract_svg(
        10,
        10,
        [
            ("#ffffff", ["M0,0 H10 V10 H0 Z"]),
            ("#ff0000", ["M0,0 H5 V10 H0 Z"]),
            ("#00ff00", ["M0,0 H5 V10 H0 Z"]),  # hides the red entirely
            ("#000080", ["M5,5 H10 V10 H5 Z"]),
        ],
    )
)


def test_colors_in_order_with_the_share_they_show() -> None:
    colors = palette_colors(DOCUMENT)

    assert [color.hex for color in colors] == ["#ffffff", "#00ff00", "#000080"]
    assert [color.share for color in colors] == pytest.approx([0.25, 0.5, 0.25])


def test_gpl_lists_rgb_and_names() -> None:
    text = export_palette(DOCUMENT, "gpl", "Logo").decode()

    assert text.startswith("GIMP Palette\nName: Logo\n")
    assert "255 255 255\tColor 1 #ffffff" in text
    assert "  0   0 128\tColor 3 #000080" in text


def test_ase_is_adobe_swatch_exchange() -> None:
    data = export_palette(DOCUMENT, "ase")

    assert data[:4] == b"ASEF"
    assert struct.unpack(">HHI", data[4:12]) == (1, 0, 3)
    kind, length, chars = struct.unpack(">HIH", data[12:20])
    name = "Color 1 #ffffff"
    assert (kind, chars) == (0x0001, len(name) + 1)
    assert data[20 : 20 + 2 * len(name)].decode("utf-16-be") == name
    start = 20 + 2 * chars
    assert data[start : start + 4] == b"RGB "
    assert struct.unpack(">3fH", data[start + 4 : start + 18]) == (1.0, 1.0, 1.0, 2)
    assert length == 2 + 2 * chars + 4 + 12 + 2


def test_css_and_json() -> None:
    css = export_palette(DOCUMENT, "css").decode()
    entries = json.loads(export_palette(DOCUMENT, "json"))["colors"]

    assert "  --color-2: #00ff00; /* 50.0% */" in css
    assert entries[2] == {
        "number": 3,
        "hex": "#000080",
        "rgb": [0, 0, 128],
        "share": 0.25,
        "shapes": 1,
    }
