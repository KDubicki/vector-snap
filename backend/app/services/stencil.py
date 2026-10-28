"""Turn a vector document into a stencil to cut (SVG or DXF): paint goes through the cuts.

The cuts are the kept colors united; the sheet is a rectangle around them. Cutting the
inside of an O would drop its middle: every piece of sheet that the cuts set loose (an
island) is held by **bridges**, strips of sheet left across the cut on both sides of
it. They run horizontally through the island first; islands still loose after that
(held only by other loose islands) get vertical bridges too. For a design in several
colors, one stencil per color, all on the same sheet, are painted one after the other.
See
docs/13-export-formats.md#stencil.
"""

import io
import zipfile
from dataclasses import dataclass, replace
from typing import Literal

from ezdxf.filemanagement import new as new_drawing
from lxml import etree
from shapely import LineString, Polygon, affinity, box, unary_union
from shapely.geometry.base import BaseGeometry

from app import __version__
from app.core.errors import InvalidParameters
from app.services.export_layers import color_documents
from app.services.svg_geometry import (
    SVG_NS,
    VectorDocument,
    layer_geometries,
    path_data,
    polygons,
)

StencilFormat = Literal["svg", "dxf"]
BridgeDirection = Literal["horizontal", "vertical", "both"]

# Cut pieces smaller than this (mm²) are specks no paint would show.
MIN_CUT_MM2 = 1.0
# A piece of sheet touches a bridge line when this close (mm).
_TOUCH_MM = 1e-6


@dataclass(frozen=True)
class StencilOptions:
    stencil_format: StencilFormat = "svg"
    width_mm: float = 100.0  # the design's width
    margin_mm: float = 10.0  # sheet around the cuts
    bridge_mm: float = 1.5  # bridge width
    bridges: BridgeDirection = "horizontal"  # first direction tried
    per_color: bool = False  # a ZIP of one stencil per color instead of one for all
    exclude: frozenset[int] = frozenset()  # palette indices left out, e.g. the background


@dataclass(frozen=True)
class Stencil:
    """Sheet and cuts in mm, y pointing down, the sheet's corner at the origin."""

    sheet: Polygon
    cuts: BaseGeometry
    bridges: int


def _loose(sheet: Polygon, cuts: BaseGeometry) -> list[Polygon]:
    """Pieces of sheet the cuts set loose: all but the one along the sheet's edge."""
    return [piece for piece in polygons(sheet - cuts) if not piece.intersects(sheet.exterior)]


def _bridge_lines(
    piece: Polygon, cuts: BaseGeometry, sheet: Polygon, vertical: bool
) -> list[LineString]:
    """The stretches of cut on both sides of `piece`, along a line through it."""
    x, y = piece.representative_point().coords[0]
    left, top, right, bottom = sheet.bounds
    line = LineString([(x, top), (x, bottom)] if vertical else [(left, y), (right, y)])
    crossing = line.intersection(cuts)
    stretches = getattr(crossing, "geoms", [crossing])
    return [
        part
        for part in stretches
        if isinstance(part, LineString) and not part.is_empty and part.distance(piece) < _TOUCH_MM
    ]


def _bridged(
    sheet: Polygon, cuts: BaseGeometry, pieces: list[Polygon], width: float, vertical: bool
) -> tuple[BaseGeometry, int]:
    """`cuts` with bridges across them on both sides of every piece."""
    lines = [line for piece in pieces for line in _bridge_lines(piece, cuts, sheet, vertical)]
    if not lines:
        return cuts, 0
    strips = unary_union([line.buffer(width / 2, cap_style="flat") for line in lines])
    return cuts - strips, len(lines)


def _kept(document: VectorDocument, options: StencilOptions) -> VectorDocument:
    kept = replace(
        document,
        layers=[layer for layer in document.layers if layer.palette_index not in options.exclude],
    )
    if not kept.layers:
        raise InvalidParameters("Every color is excluded.", {"field": "exclude_colors"})
    return kept


def _design_cuts(document: VectorDocument, options: StencilOptions) -> BaseGeometry:
    """The document's shapes united in mm (y down), specks dropped; may be empty."""
    scale = options.width_mm / document.width
    design = affinity.scale(unary_union(layer_geometries(document)), scale, scale, origin=(0, 0))
    return unary_union([piece for piece in polygons(design) if piece.area >= MIN_CUT_MM2])


def _on_sheet(
    cuts: BaseGeometry, bounds: tuple[float, float, float, float], options: StencilOptions
) -> Stencil:
    """`cuts` on the sheet `margin_mm` around `bounds`, bridged."""
    left, top, right, bottom = bounds
    margin = options.margin_mm
    cuts = affinity.translate(cuts, margin - left, margin - top)
    sheet = box(0, 0, right - left + 2 * margin, bottom - top + 2 * margin)

    vertical = options.bridges == "vertical"
    islands = _loose(sheet, cuts)
    cuts, count = _bridged(sheet, cuts, islands, options.bridge_mm, vertical)
    # The other direction: for every island ("both"), or only for islands still loose,
    # held by nothing but other loose islands.
    again = islands if options.bridges == "both" else _loose(sheet, cuts)
    cuts, added = _bridged(sheet, cuts, again, options.bridge_mm, not vertical)
    return Stencil(sheet, cuts, count + added)


def _nothing_to_cut() -> InvalidParameters:
    return InvalidParameters("The design has nothing large enough to cut.", {"field": "svg"})


def stencil_layout(document: VectorDocument, options: StencilOptions) -> Stencil:
    """One stencil for all kept colors together."""
    cuts = _design_cuts(_kept(document, options), options)
    if cuts.is_empty:
        raise _nothing_to_cut()
    return _on_sheet(cuts, cuts.bounds, options)


def color_stencils(document: VectorDocument, options: StencilOptions) -> list[tuple[str, Stencil]]:
    """One stencil per kept color, bottom to top (the order to paint them), all on the
    same sheet so they line up: the sheet's edges are the registration."""
    colors = [
        (single.layers[0].fill, _design_cuts(single, options))
        for single in color_documents(_kept(document, options))
    ]
    colors = [(fill, cuts) for fill, cuts in colors if not cuts.is_empty]
    if not colors:
        raise _nothing_to_cut()
    bounds = unary_union([cuts for _, cuts in colors]).bounds
    return [(fill, _on_sheet(cuts, bounds, options)) for fill, cuts in colors]


def _number(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _rings(geometry: BaseGeometry) -> list[list[tuple[float, float]]]:
    return [
        [(float(x), float(y)) for x, y in ring.coords[:-1]]
        for polygon in polygons(geometry)
        for ring in [polygon.exterior, *polygon.interiors]
    ]


def _svg(stencil: Stencil) -> bytes:
    _, _, width, height = stencil.sheet.bounds
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
    etree.SubElement(
        svg,
        f"{{{SVG_NS}}}rect",
        attrib={
            "id": "sheet",
            "width": _number(width),
            "height": _number(height),
            "fill": "none",
            "stroke": "#000000",
            "stroke-width": "0.1",
        },
    )
    etree.SubElement(
        svg,
        f"{{{SVG_NS}}}path",
        attrib={
            "id": "cuts",
            "fill": "#000000",
            "fill-rule": "evenodd",
            "d": path_data(stencil.cuts),
        },
    )
    return bytes(etree.tostring(svg, xml_declaration=True, encoding="utf-8"))


def _dxf(stencil: Stencil) -> bytes:
    drawing = new_drawing("R2010", setup=False)
    drawing.units = 4  # mm
    drawing.header["$INSUNITS"] = 4
    drawing.header["$MEASUREMENT"] = 1
    modelspace = drawing.modelspace()
    height = stencil.sheet.bounds[3]
    for layer, geometry in (("sheet", stencil.sheet), ("cuts", stencil.cuts)):
        drawing.layers.add(layer)
        for ring in _rings(geometry):
            # CAD y points up.
            points = [(x, height - y) for x, y in ring]
            modelspace.add_lwpolyline(points, close=True, dxfattribs={"layer": layer})
    stream = io.StringIO()
    drawing.write(stream)
    return stream.getvalue().encode("utf-8")


def _render(stencil: Stencil, options: StencilOptions) -> bytes:
    return _svg(stencil) if options.stencil_format == "svg" else _dxf(stencil)


def export_stencil(document: VectorDocument, options: StencilOptions) -> tuple[bytes, int]:
    """The stencil file, or with `per_color` a ZIP of `stencil-<n>-<rrggbb>.<format>`,
    and how many bridges were added."""
    if not options.per_color:
        stencil = stencil_layout(document, options)
        return _render(stencil, options), stencil.bridges
    buffer = io.BytesIO()
    bridges = 0
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for number, (fill, stencil) in enumerate(color_stencils(document, options), start=1):
            name = f"stencil-{number:02d}-{fill[1:]}.{options.stencil_format}"
            archive.writestr(name, _render(stencil, options))
            bridges += stencil.bridges
    return buffer.getvalue(), bridges
