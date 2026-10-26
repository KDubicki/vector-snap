"""One file per color of a vector document, in a ZIP: for vinyl cutters (one sheet per
color, weeded and stacked), screen printing (one screen per color) and laser cutting
(one material per color).

Shapes are grouped by their color (own color or layer color), in the order the colors
first appear bottom to top. Every file keeps the whole canvas, so the colors line up
again when stacked: same SVG viewBox, same DXF coordinates, same PDF page. See
docs/13-export-formats.md#layers-zip.
"""

import io
import zipfile
from dataclasses import dataclass, replace
from typing import Literal

from app.services.export_dxf import DxfOptions, export_dxf
from app.services.export_pdf import PdfOptions, export_pdf
from app.services.svg_edit import serialize_svg
from app.services.svg_geometry import VectorDocument, VectorLayer, shapes_geometry

LayerFormat = Literal["svg", "dxf", "pdf"]


@dataclass(frozen=True)
class LayersOptions:
    layer_format: LayerFormat = "svg"
    width_mm: float = 100.0  # DXF and PDF drawing width
    margin_mm: float = 0.0  # PDF page margin


def color_documents(document: VectorDocument) -> list[VectorDocument]:
    """The document split by color: one single-layer document per color, bottom to top."""
    by_color: dict[str, VectorLayer] = {}
    for layer in document.layers:
        for shape in layer.shapes:
            current = by_color.setdefault(
                shape.fill, VectorLayer(palette_index=len(by_color), fill=shape.fill, shapes=[])
            )
            current.shapes.append(shape)
    return [replace(document, layers=[layer]) for layer in by_color.values()]


def _render(document: VectorDocument, options: LayersOptions) -> bytes:
    if options.layer_format == "dxf":
        return export_dxf(document, DxfOptions(width_mm=options.width_mm))
    if options.layer_format == "pdf":
        return export_pdf(
            document, PdfOptions(width_mm=options.width_mm, margin_mm=options.margin_mm)
        )
    return serialize_svg(document).encode()


def export_layers(document: VectorDocument, options: LayersOptions) -> bytes:
    """ZIP of `color-<n>-<rrggbb>.<format>` files plus `colors.txt` (file, color, shapes,
    area at `width_mm`)."""
    mm_per_px = options.width_mm / document.width
    buffer = io.BytesIO()
    lines = ["file\tcolor\tshapes\tarea_mm2"]
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for number, single in enumerate(color_documents(document), start=1):
            layer = single.layers[0]
            name = f"color-{number:02d}-{layer.fill[1:]}.{options.layer_format}"
            archive.writestr(name, _render(single, options))
            area = shapes_geometry(layer.shapes).area * mm_per_px**2
            lines.append(f"{name}\t{layer.fill}\t{len(layer.shapes)}\t{area:.1f}")
        archive.writestr("colors.txt", "\n".join(lines) + "\n")
    return buffer.getvalue()
