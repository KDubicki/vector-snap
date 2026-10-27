"""Turn a vector document into a print-and-cut sticker (SVG or PDF).

The design sits on a background grown around its silhouette (holes filled, narrow
notches closed, as for a cookie cutter), and the cut line runs along that background's
edge: a hairline path named and colored `CutContour`, the spot color print-and-cut
plotters (Roland, Mimaki, Summa) and their RIPs cut along without printing it. Cricut
and Silhouette import the SVG as print-then-cut. Colors can be left out, like a
background around the design. See docs/13-export-formats.md#sticker.
"""

import io
from dataclasses import dataclass, replace
from typing import Literal

from lxml import etree
from reportlab.lib.colors import CMYKColorSep
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import FILL_EVEN_ODD, Canvas
from reportlab.pdfgen.pathobject import PDFPathObject
from shapely import affinity, unary_union
from shapely.geometry.base import BaseGeometry

from app import __version__
from app.core.errors import InvalidParameters
from app.services.cookie_cutter import cutter_outline
from app.services.export_pdf import draw_shapes
from app.services.svg_geometry import SVG_NS, Point, VectorDocument, layer_geometries, polygons

StickerFormat = Literal["svg", "pdf"]

# The spot color plotters cut along; magenta is how design tools show it.
CUT_CONTOUR = "CutContour"
CUT_COLOR = "#ec008c"
CUT_LINE_MM = 0.1


@dataclass(frozen=True)
class StickerOptions:
    sticker_format: StickerFormat = "svg"
    width_mm: float = 70.0  # the design's width; the border comes on top
    border_mm: float = 3.0  # background beyond the design's silhouette
    background: str = "#ffffff"
    smooth_mm: float = 1.0  # notches narrower than twice this are closed
    margin_mm: float = 5.0  # PDF page margin around the cut line
    exclude: frozenset[int] = frozenset()  # palette indices left out, e.g. the background


@dataclass(frozen=True)
class Sticker:
    """The kept design and the sticker outline, both in mm with y pointing down."""

    document: VectorDocument
    scale: float  # mm per document px
    outline: BaseGeometry  # background and cut line


def sticker_layout(document: VectorDocument, options: StickerOptions) -> Sticker:
    kept = replace(
        document,
        layers=[layer for layer in document.layers if layer.palette_index not in options.exclude],
    )
    if not kept.layers:
        raise InvalidParameters("Every color is excluded.", {"field": "exclude_colors"})
    scale = options.width_mm / document.width
    design = affinity.scale(unary_union(layer_geometries(kept)), scale, scale, origin=(0, 0))
    silhouette = cutter_outline(design, options.smooth_mm)
    if silhouette.is_empty:
        raise InvalidParameters("The design has no outline large enough for a sticker.")
    outline = silhouette.buffer(options.border_mm) if options.border_mm > 0 else silhouette
    return Sticker(kept, scale, outline)


def _number(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _path_data(geometry: BaseGeometry, dx: float, dy: float) -> str:
    rings = [
        ring.coords
        for polygon in polygons(geometry)
        for ring in [polygon.exterior, *polygon.interiors]
    ]
    return " ".join(
        "M" + " L".join(f"{_number(x + dx)},{_number(y + dy)}" for x, y in ring[:-1]) + " Z"
        for ring in rings
    )


def _svg(sticker: Sticker, options: StickerOptions) -> bytes:
    left, top, right, bottom = sticker.outline.bounds
    width, height = right - left, bottom - top
    svg = etree.Element(
        f"{{{SVG_NS}}}svg",
        nsmap={None: SVG_NS},
        attrib={
            "viewBox": f"0 0 {_number(width)} {_number(height)}",
            "width": f"{_number(width)}mm",
            "height": f"{_number(height)}mm",
            "data-generator": f"vectorsnap/{__version__}",
        },
    )
    outline = _path_data(sticker.outline, -left, -top)
    etree.SubElement(
        svg,
        f"{{{SVG_NS}}}path",
        attrib={"id": "background", "fill": options.background, "d": outline},
    )
    design = etree.SubElement(
        svg,
        f"{{{SVG_NS}}}g",
        attrib={
            "id": "design",
            "transform": f"translate({_number(-left)} {_number(-top)}) scale({sticker.scale:.6g})",
        },
    )
    for layer in sticker.document.layers:
        for shape in layer.shapes:
            etree.SubElement(design, f"{{{SVG_NS}}}path", attrib={"fill": shape.fill, "d": shape.d})
    etree.SubElement(
        svg,
        f"{{{SVG_NS}}}path",
        attrib={
            "id": CUT_CONTOUR,
            "fill": "none",
            "stroke": CUT_COLOR,
            "stroke-width": _number(CUT_LINE_MM),
            "d": outline,
        },
    )
    return bytes(etree.tostring(svg, xml_declaration=True, encoding="utf-8"))


def _pdf(sticker: Sticker, options: StickerOptions) -> bytes:
    left, top, right, bottom = sticker.outline.bounds
    margin = options.margin_mm
    page = ((right - left + 2 * margin) * mm, (bottom - top + 2 * margin) * mm)

    def page_point(x: float, y: float) -> tuple[float, float]:
        """mm, y down → PDF points, y up."""
        return ((x - left + margin) * mm, page[1] - (y - top + margin) * mm)

    def design_point(p: Point) -> tuple[float, float]:
        return page_point(p[0] * sticker.scale, p[1] * sticker.scale)

    def outline_path() -> PDFPathObject:
        path = canvas.beginPath()
        for polygon in polygons(sticker.outline):
            for ring in [polygon.exterior, *polygon.interiors]:
                coords = list(ring.coords)[:-1]
                path.moveTo(*page_point(*coords[0]))
                for x, y in coords[1:]:
                    path.lineTo(*page_point(x, y))
                path.close()
        return path

    buffer = io.BytesIO()
    canvas = Canvas(buffer, pagesize=page, pageCompression=1)
    canvas.setTitle("VectorSnap sticker")
    canvas.setCreator(f"VectorSnap {__version__}")
    canvas.setFillColor(options.background)
    canvas.drawPath(outline_path(), stroke=0, fill=1, fillMode=FILL_EVEN_ODD)
    draw_shapes(canvas, sticker.document, design_point)
    # A spot color on top that only marks where to cut: overprinted, never knocking out
    # the print below it.
    canvas.setStrokeColor(CMYKColorSep(0, 1, 0, 0, spotName=CUT_CONTOUR, density=1))
    canvas.setStrokeOverprint(True)
    canvas.setLineWidth(CUT_LINE_MM * mm)
    canvas.drawPath(outline_path(), stroke=1, fill=0)
    canvas.showPage()
    canvas.save()
    return buffer.getvalue()


def export_sticker(document: VectorDocument, options: StickerOptions) -> bytes:
    """The sticker as SVG (mm) or PDF (page fitted to the cut line plus `margin_mm`)."""
    sticker = sticker_layout(document, options)
    return _svg(sticker, options) if options.sticker_format == "svg" else _pdf(sticker, options)
