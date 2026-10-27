"""Export a vector document as PDF with exact curves for print.

Path segments are written as native PDF path operators (cubic Béziers stay curves;
quadratic curves and arcs are converted to cubic), filled with the nonzero rule like SVG.
The page either fits the drawing or is a standard size with the drawing scaled to fit
inside the margins. See docs/13-export-formats.md#pdf.
"""

import io
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from reportlab.lib.pagesizes import A4, LETTER
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import FILL_NON_ZERO, Canvas

from app import __version__
from app.services.svg_geometry import Point, VectorDocument, curve_path

PageSize = Literal["fit", "a4", "letter"]
_PAGES: dict[str, tuple[float, float]] = {"a4": A4, "letter": LETTER}


@dataclass(frozen=True)
class PdfOptions:
    page: PageSize = "fit"
    width_mm: float = 100.0  # drawing width for page="fit"
    margin_mm: float = 10.0


@dataclass(frozen=True)
class _Placement:
    scale: float  # PDF points per document px
    x: float  # page offset of the drawing's left edge
    y: float  # page offset of the drawing's bottom edge
    page: tuple[float, float]


def _placement(document: VectorDocument, options: PdfOptions) -> _Placement:
    margin = options.margin_mm * mm
    if options.page == "fit":
        scale = options.width_mm * mm / document.width
        size = (document.width * scale + 2 * margin, document.height * scale + 2 * margin)
        return _Placement(scale, margin, margin, size)

    short, long = sorted(_PAGES[options.page])
    landscape = document.width > document.height
    width, height = (long, short) if landscape else (short, long)
    scale = min((width - 2 * margin) / document.width, (height - 2 * margin) / document.height)
    x = (width - document.width * scale) / 2
    y = (height - document.height * scale) / 2
    return _Placement(scale, x, y, (width, height))


def draw_shapes(
    canvas: Canvas, document: VectorDocument, point: Callable[[Point], tuple[float, float]]
) -> None:
    """Fill every shape of the document in its color, bottom layer first; `point` maps
    document px to page points."""
    for layer in document.layers:
        for shape in layer.shapes:
            path = canvas.beginPath()
            for command, points in curve_path(shape.d):
                if command == "M":
                    path.moveTo(*point(points[0]))
                elif command == "L":
                    path.lineTo(*point(points[0]))
                elif command == "C":
                    path.curveTo(*point(points[0]), *point(points[1]), *point(points[2]))
                else:
                    path.close()
            canvas.setFillColor(shape.fill)
            canvas.drawPath(path, stroke=0, fill=1, fillMode=FILL_NON_ZERO)


def export_pdf(document: VectorDocument, options: PdfOptions) -> bytes:
    """Return a one-page PDF with every shape filled in its color."""
    placement = _placement(document, options)

    def point(p: Point) -> tuple[float, float]:
        return (
            placement.x + p[0] * placement.scale,
            placement.y + (document.height - p[1]) * placement.scale,
        )

    buffer = io.BytesIO()
    canvas = Canvas(buffer, pagesize=placement.page, pageCompression=1)
    canvas.setTitle("VectorSnap export")
    canvas.setCreator(f"VectorSnap {__version__}")

    draw_shapes(canvas, document, point)

    canvas.showPage()
    canvas.save()
    return buffer.getvalue()
