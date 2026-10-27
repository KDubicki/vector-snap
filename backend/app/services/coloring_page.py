"""Turn a vector document into a coloring page or paint-by-numbers sheet (PDF).

Only the outlines are printed: the edge of every region a color shows (what is visible
of it, shapes above cut away), black on white, scaled to fit an A4 or Letter page.
For paint by numbers, every region large enough carries its color's number at the point
farthest from its edges, and a legend under the drawing shows the colors with their
numbers. Colors can be left out, like a background: they stay white and unnumbered. See
docs/13-export-formats.md#coloring-page.
"""

import io
from dataclasses import dataclass
from typing import Literal

from reportlab.lib.pagesizes import A4, LETTER
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from shapely import Polygon, affinity, unary_union
from shapely.geometry.base import BaseGeometry
from shapely.ops import polylabel

from app import __version__
from app.core.errors import InvalidParameters
from app.services.svg_geometry import VectorDocument, flatten, polygons, to_polygon

ColoringPageSize = Literal["a4", "letter"]

_PAGES: dict[str, tuple[float, float]] = {"a4": A4, "letter": LETTER}
# Numbers between these sizes (pt); regions too small for the smallest stay unnumbered.
MAX_NUMBER_PT = 14.0
MIN_NUMBER_PT = 4.5
NUMBER_COLOR = "#606060"
# Legend under the drawing: swatch size and the room one entry takes (mm).
SWATCH_MM = 7.0
LEGEND_ENTRY_MM = 34.0
LEGEND_GAP_MM = 6.0


@dataclass(frozen=True)
class ColoringOptions:
    page: ColoringPageSize = "a4"
    margin_mm: float = 12.0
    line_mm: float = 0.4
    numbers: bool = True  # paint by numbers: numbered regions and a legend
    exclude: frozenset[int] = frozenset()  # palette indices left white, e.g. the background


@dataclass(frozen=True)
class Region:
    number: int  # 1-based, the color's place in the legend
    fill: str
    polygon: Polygon  # page points, y up


def visible_regions(document: VectorDocument) -> list[tuple[str, int, BaseGeometry]]:
    """What every shape shows of itself, top shapes cut out of lower ones, as
    (fill, palette index, geometry in document px), bottom first."""
    shapes = [
        (shape.fill, layer.palette_index, to_polygon(flatten(shape.d)))
        for layer in document.layers
        for shape in layer.shapes
    ]
    covered: BaseGeometry = Polygon()
    visible = []
    for fill, index, geometry in reversed(shapes):
        visible.append((fill, index, geometry - covered))
        covered = unary_union([covered, geometry])
    return visible[::-1]


def _legend_rows(colors: int, width: float) -> int:
    per_row = max(1, int(width // (LEGEND_ENTRY_MM * mm)))
    return -(-colors // per_row)


def coloring_layout(
    document: VectorDocument, options: ColoringOptions
) -> tuple[list[Region], list[str], tuple[float, float], float]:
    """Regions on the page, the legend's colors (number = place + 1), the page size and
    the drawing's bottom edge (where the legend goes below)."""
    visible = [
        (fill, geometry)
        for fill, index, geometry in visible_regions(document)
        if index not in options.exclude and not geometry.is_empty
    ]
    if not visible:
        raise InvalidParameters("Every color is excluded.", {"field": "exclude_colors"})
    colors = list(dict.fromkeys(fill for fill, _ in visible))

    short, long = sorted(_PAGES[options.page])
    width, height = (long, short) if document.width > document.height else (short, long)
    margin = options.margin_mm * mm
    legend = 0.0
    if options.numbers:
        rows = _legend_rows(len(colors), width - 2 * margin)
        legend = LEGEND_GAP_MM * mm + rows * (SWATCH_MM + 3) * mm
    area_width, area_height = width - 2 * margin, height - 2 * margin - legend
    scale = min(area_width / document.width, area_height / document.height)
    left = (width - document.width * scale) / 2
    top = height - margin  # the drawing hangs from the top margin

    def placed(geometry: BaseGeometry) -> BaseGeometry:
        flipped = affinity.scale(geometry, scale, -scale, origin=(0, 0))
        return affinity.translate(flipped, left, top)

    regions = [
        Region(colors.index(fill) + 1, fill, polygon)
        for fill, geometry in visible
        for polygon in polygons(placed(geometry))
    ]
    return regions, colors, (width, height), top - document.height * scale


def number_spot(polygon: Polygon) -> tuple[float, float, float] | None:
    """Where a number fits best and its size (pt), or None when the region is too small."""
    spot = polylabel(polygon, tolerance=0.5)
    room = polygon.boundary.distance(spot)
    size = min(MAX_NUMBER_PT, room * 1.2)
    return (spot.x, spot.y, size) if size >= MIN_NUMBER_PT else None


def export_coloring_page(document: VectorDocument, options: ColoringOptions) -> bytes:
    """One-page PDF of the outlines, numbered and with a legend when `numbers`."""
    regions, colors, page, bottom = coloring_layout(document, options)
    buffer = io.BytesIO()
    canvas = Canvas(buffer, pagesize=page, pageCompression=1)
    canvas.setTitle("VectorSnap coloring page")
    canvas.setCreator(f"VectorSnap {__version__}")
    canvas.setLineWidth(options.line_mm * mm)
    canvas.setLineJoin(1)
    canvas.setStrokeColor("#000000")
    for region in regions:
        path = canvas.beginPath()
        for ring in [region.polygon.exterior, *region.polygon.interiors]:
            coords = list(ring.coords)[:-1]
            path.moveTo(*coords[0])
            for point in coords[1:]:
                path.lineTo(*point)
            path.close()
        canvas.drawPath(path, stroke=1, fill=0)

    if options.numbers:
        canvas.setFillColor(NUMBER_COLOR)
        for region in regions:
            spot = number_spot(region.polygon)
            if spot:
                x, y, size = spot
                canvas.setFont("Helvetica", size)
                canvas.drawCentredString(x, y - size * 0.35, str(region.number))
        _draw_legend(canvas, colors, page, bottom, options.margin_mm * mm)

    canvas.showPage()
    canvas.save()
    return buffer.getvalue()


def _draw_legend(
    canvas: Canvas, colors: list[str], page: tuple[float, float], bottom: float, margin: float
) -> None:
    per_row = max(1, int((page[0] - 2 * margin) // (LEGEND_ENTRY_MM * mm)))
    top = bottom - LEGEND_GAP_MM * mm
    canvas.setLineWidth(0.5)
    for place, color in enumerate(colors):
        row, column = divmod(place, per_row)
        x = margin + column * LEGEND_ENTRY_MM * mm
        y = top - (row + 1) * (SWATCH_MM + 3) * mm + 3 * mm
        canvas.setFillColor(color)
        canvas.setStrokeColor("#000000")
        canvas.rect(x, y, SWATCH_MM * mm, SWATCH_MM * mm, stroke=1, fill=1)
        canvas.setFillColor("#000000")
        canvas.setFont("Helvetica-Bold", 10)
        canvas.drawString(x + (SWATCH_MM + 2) * mm, y + 3.6 * mm, str(place + 1))
        canvas.setFont("Helvetica", 7)
        canvas.drawString(x + (SWATCH_MM + 2) * mm, y + 0.6 * mm, color)
