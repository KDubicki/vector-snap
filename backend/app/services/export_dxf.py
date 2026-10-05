"""Export a vector document as DXF for laser cutters, vinyl plotters and CNC.

Every color layer becomes a DXF layer (`color-<paletteIndex>`, true color set) holding
closed LWPOLYLINE outlines (holes included) in millimetres with the y axis flipped;
optionally solid HATCH fills. See docs/13-export-formats.md#dxf.
"""

import io
from dataclasses import dataclass

from ezdxf.colors import RGB, rgb2int
from ezdxf.filemanagement import new as new_drawing
from ezdxf.lldxf.const import BOUNDARY_PATH_EXTERNAL
from shapely import Polygon

from app.services.svg_geometry import (
    VectorDocument,
    layer_geometries,
    polygons,
    to_millimetres,
)

DXF_VERSION = "R2010"
UNITS_MM = 4  # $INSUNITS value for millimetres


@dataclass(frozen=True)
class DxfOptions:
    width_mm: float = 100.0
    fill: bool = False


def _rgb(hex_color: str) -> RGB:
    return RGB(int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16))


def _rings(polygon: Polygon) -> list[list[tuple[float, float]]]:
    return [
        [(float(x), float(y)) for x, y in ring.coords[:-1]]
        for ring in [polygon.exterior, *polygon.interiors]
    ]


def export_dxf(document: VectorDocument, options: DxfOptions) -> bytes:
    """Return a DXF (R2010, units mm) with one layer per color."""
    drawing = new_drawing(DXF_VERSION, setup=False)
    drawing.units = UNITS_MM
    drawing.header["$INSUNITS"] = UNITS_MM
    drawing.header["$MEASUREMENT"] = 1  # metric
    modelspace = drawing.modelspace()

    for layer, geometry in zip(document.layers, layer_geometries(document), strict=True):
        name = f"color-{layer.palette_index}"
        dxf_layer = drawing.layers.add(name)
        dxf_layer.rgb = _rgb(layer.fill)
        attributes = {"layer": name, "true_color": rgb2int(_rgb(layer.fill))}

        for polygon in polygons(to_millimetres(geometry, document, options.width_mm)):
            rings = _rings(polygon)
            for ring in rings:
                modelspace.add_lwpolyline(ring, close=True, dxfattribs=attributes)
            if options.fill:
                hatch = modelspace.add_hatch(dxfattribs=attributes)
                hatch.set_solid_fill(rgb=_rgb(layer.fill))
                for index, ring in enumerate(rings):
                    flags = BOUNDARY_PATH_EXTERNAL if index == 0 else 0
                    hatch.paths.add_polyline_path(ring, is_closed=True, flags=flags)

    stream = io.StringIO()
    drawing.write(stream)
    return stream.getvalue().encode("utf-8")
