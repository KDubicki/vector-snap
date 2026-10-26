"""Render a vector document as a PNG image: previews, web, print shops, stickers.

Every shape is filled in its color, bottom layer first, as in the SVG. Curves are
flattened finer than a pixel and the image is drawn larger and scaled down (supersampled)
for smooth edges. The background is transparent or one color. See
docs/13-export-formats.md#png.
"""

import io
import math
from dataclasses import dataclass

from PIL import Image, ImageDraw
from shapely import affinity

from app.services.svg_geometry import VectorDocument, flatten, polygons, to_polygon

# Drawn this many times larger, then scaled down for anti-aliased edges...
SUPERSAMPLE = 4
# ...as long as the larger canvas stays below this many pixels a side (memory).
MAX_CANVAS_PX = 6144


@dataclass(frozen=True)
class PngOptions:
    width_px: int = 1024
    background: str | None = None  # "#rrggbb"; None = transparent
    dpi: int = 300  # stored in the file, for print at a size


def _rgba(fill: str) -> tuple[int, int, int, int]:
    return (int(fill[1:3], 16), int(fill[3:5], 16), int(fill[5:7], 16), 255)


def export_png(document: VectorDocument, options: PngOptions) -> bytes:
    """Return a PNG of the document `width_px` wide (height in proportion)."""
    width = options.width_px
    height = max(1, round(width * document.height / document.width))
    factor = max(1, min(SUPERSAMPLE, MAX_CANVAS_PX // max(width, height)))
    scale = width * factor / document.width
    canvas = Image.new(
        "RGBA",
        (width * factor, height * factor),
        _rgba(options.background) if options.background else (0, 0, 0, 0),
    )
    # A quarter of a canvas pixel: curves look round at any size.
    tolerance = 0.25 / scale
    for layer in document.layers:
        for shape in layer.shapes:
            geometry = affinity.scale(
                to_polygon(flatten(shape.d, tolerance)), scale, scale, origin=(0, 0)
            )
            if geometry.is_empty:
                continue
            left, top, right, bottom = geometry.bounds
            box = (math.floor(left), math.floor(top), math.ceil(right) + 1, math.ceil(bottom) + 1)
            mask = Image.new("L", (box[2] - box[0], box[3] - box[1]), 0)
            draw = ImageDraw.Draw(mask)
            for polygon in polygons(affinity.translate(geometry, -box[0], -box[1])):
                draw.polygon(list(polygon.exterior.coords), fill=255)
                for hole in polygon.interiors:
                    draw.polygon(list(hole.coords), fill=0)
            canvas.paste(_rgba(shape.fill), box, mask)
    image = canvas.resize((width, height), Image.Resampling.LANCZOS) if factor > 1 else canvas
    buffer = io.BytesIO()
    image.save(buffer, "PNG", optimize=True, dpi=(options.dpi, options.dpi))
    return buffer.getvalue()
