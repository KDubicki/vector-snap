"""Export the colors of a vector document as a palette file for other tools.

GIMP and Inkscape read `.gpl`, Adobe Illustrator, Photoshop and InDesign `.ase` (Adobe
Swatch Exchange), the web CSS custom properties, scripts JSON. Colors are listed in the
order they first appear, bottom to top, each with the share of the image it shows
(what shapes above leave visible); colors hidden entirely are left out. See
docs/13-export-formats.md#palette.
"""

import json
import struct
from dataclasses import dataclass
from typing import Literal

from app.schemas.palette import hex_to_rgb
from app.services.coloring_page import visible_regions
from app.services.svg_geometry import VectorDocument

PaletteFormat = Literal["gpl", "ase", "css", "json"]

MEDIA_TYPES: dict[str, str] = {
    "gpl": "text/plain; charset=utf-8",
    "ase": "application/octet-stream",
    "css": "text/css; charset=utf-8",
    "json": "application/json",
}


@dataclass(frozen=True)
class PaletteColor:
    hex: str
    share: float  # of the visible design, 0 to 1
    shapes: int


def palette_colors(document: VectorDocument) -> list[PaletteColor]:
    areas: dict[str, float] = {}
    shapes: dict[str, int] = {}
    for fill, _, geometry in visible_regions(document):
        if geometry.is_empty:  # hidden under shapes above: nothing to color
            continue
        areas[fill] = areas.get(fill, 0.0) + geometry.area
        shapes[fill] = shapes.get(fill, 0) + 1
    total = sum(areas.values()) or 1.0
    return [PaletteColor(fill, areas[fill] / total, shapes[fill]) for fill in areas]


def _name(number: int, color: PaletteColor) -> str:
    return f"Color {number} {color.hex}"


def _gpl(colors: list[PaletteColor], title: str) -> bytes:
    lines = ["GIMP Palette", f"Name: {title}", "Columns: 8", "#"]
    for number, color in enumerate(colors, start=1):
        red, green, blue = hex_to_rgb(color.hex)
        lines.append(f"{red:3d} {green:3d} {blue:3d}\t{_name(number, color)}")
    return ("\n".join(lines) + "\n").encode()


def _ase(colors: list[PaletteColor]) -> bytes:
    """Adobe Swatch Exchange 1.0: one RGB process color block per color."""
    blocks = []
    for number, color in enumerate(colors, start=1):
        name = _name(number, color).encode("utf-16-be") + b"\0\0"
        body = (
            struct.pack(">H", len(name) // 2)
            + name
            + b"RGB "
            + struct.pack(">3f", *(channel / 255 for channel in hex_to_rgb(color.hex)))
            + struct.pack(">H", 2)  # normal (process) color
        )
        blocks.append(struct.pack(">HI", 0x0001, len(body)) + body)
    return b"ASEF" + struct.pack(">HHI", 1, 0, len(blocks)) + b"".join(blocks)


def _css(colors: list[PaletteColor]) -> bytes:
    lines = [":root {"]
    lines += [
        f"  --color-{number}: {color.hex}; /* {color.share:.1%} */"
        for number, color in enumerate(colors, start=1)
    ]
    return ("\n".join([*lines, "}"]) + "\n").encode()


def _json(colors: list[PaletteColor]) -> bytes:
    entries = [
        {
            "number": number,
            "hex": color.hex,
            "rgb": list(hex_to_rgb(color.hex)),
            "share": round(color.share, 4),
            "shapes": color.shapes,
        }
        for number, color in enumerate(colors, start=1)
    ]
    return json.dumps({"colors": entries}, indent=2).encode()


def export_palette(
    document: VectorDocument, palette_format: PaletteFormat, title: str = "VectorSnap"
) -> bytes:
    colors = palette_colors(document)
    if palette_format == "gpl":
        return _gpl(colors, title)
    if palette_format == "ase":
        return _ase(colors)
    if palette_format == "css":
        return _css(colors)
    return _json(colors)
