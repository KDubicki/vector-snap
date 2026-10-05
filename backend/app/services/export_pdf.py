"""Export a vector document as PDF with exact curves for print.

Path segments are written as native PDF path operators (cubic Béziers stay curves;
quadratic curves and arcs are converted to cubic), filled with the nonzero rule like SVG.
The page either fits the drawing or is a standard size with the drawing scaled to fit
inside the margins. See docs/13-export-formats.md#pdf.
"""

import io
from dataclasses import dataclass
from typing import Literal

import svgelements
from reportlab.lib.pagesizes import A4, LETTER
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import FILL_NON_ZERO, Canvas

from app import __version__
from app.services.svg_geometry import VectorDocument

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


def export_pdf(document: VectorDocument, options: PdfOptions) -> bytes:
    """Return a one-page PDF with every shape filled in its color."""
    placement = _placement(document, options)

    def point(p: svgelements.Point) -> tuple[float, float]:
        return (
            placement.x + float(p.x) * placement.scale,
            placement.y + (document.height - float(p.y)) * placement.scale,
        )

    buffer = io.BytesIO()
    canvas = Canvas(buffer, pagesize=placement.page, pageCompression=1)
    canvas.setTitle("VectorSnap export")
    canvas.setCreator(f"VectorSnap {__version__}")

    for layer in document.layers:
        for shape in layer.shapes:
            path = canvas.beginPath()
            for segment in svgelements.Path(shape.d):
                if isinstance(segment, svgelements.Move):
                    path.moveTo(*point(segment.end))
                elif isinstance(segment, svgelements.Close):
                    path.close()
                elif isinstance(segment, svgelements.Line):
                    path.lineTo(*point(segment.end))
                elif isinstance(segment, svgelements.CubicBezier):
                    path.curveTo(
                        *point(segment.control1), *point(segment.control2), *point(segment.end)
                    )
                elif isinstance(segment, svgelements.QuadraticBezier):
                    start, control, end = segment.start, segment.control, segment.end
                    path.curveTo(
                        *point(start + (control - start) * (2 / 3)),
                        *point(end + (control - end) * (2 / 3)),
                        *point(end),
                    )
                elif isinstance(segment, svgelements.Arc):
                    for curve in segment.as_cubic_curves():
                        path.curveTo(
                            *point(curve.control1), *point(curve.control2), *point(curve.end)
                        )
            canvas.setFillColor(shape.fill)
            canvas.drawPath(path, stroke=0, fill=1, fillMode=FILL_NON_ZERO)

    canvas.showPage()
    canvas.save()
    return buffer.getvalue()
