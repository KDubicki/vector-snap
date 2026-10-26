"""Turn the outline of a vector document into a cookie cutter (STL).

The cutter follows the design's silhouette: every shape united, holes filled (a cutter
only cuts the outside), narrow notches the dough cannot follow closed. A thin blade
stands on that outline, its inside exactly the cookie's shape, and a wider flange at its
foot makes it stiff and comfortable to press. Printed flange down and used flange up,
so the footprint is mirrored by default and the cookie comes out as the design (text
reads right). Colors can be left out, like a background around the design. See
docs/13-export-formats.md#cookie-cutter.
"""

from dataclasses import dataclass, replace

import numpy as np
from shapely import Polygon, affinity, unary_union
from shapely.geometry.base import BaseGeometry

from app.core.errors import InvalidParameters
from app.services.mesh import prism, without_pinches, write_stl
from app.services.svg_geometry import (
    VectorDocument,
    layer_geometries,
    polygons,
    to_millimetres,
)

# Outline pieces smaller than this (mm²) are specks, not cookies.
MIN_PIECE_MM2 = 4.0


@dataclass(frozen=True)
class CookieCutterOptions:
    width_mm: float = 80.0
    height_mm: float = 15.0  # blade top above the bed
    wall_mm: float = 1.2  # blade thickness
    flange_mm: float = 4.0  # how far the flange reaches beyond the blade; 0 = none
    flange_height_mm: float = 2.0
    smooth_mm: float = 1.0  # notches narrower than twice this are closed
    mirror: bool = True
    exclude: frozenset[int] = frozenset()  # palette indices left out, e.g. the background


def cutter_outline(geometry: BaseGeometry, smooth_mm: float) -> BaseGeometry:
    """The silhouette of a design (mm): holes filled, narrow notches closed, specks gone."""
    filled = unary_union([Polygon(polygon.exterior) for polygon in polygons(geometry)])
    if smooth_mm > 0:
        filled = filled.buffer(smooth_mm).buffer(-smooth_mm)
    pieces = [Polygon(p.exterior) for p in polygons(filled) if p.area >= MIN_PIECE_MM2]
    return unary_union(pieces)


def _check(options: CookieCutterOptions) -> None:
    if options.flange_mm > 0 and options.flange_height_mm >= options.height_mm:
        raise InvalidParameters(
            "The flange must be lower than the cutter (`flange_height_mm` < `height_mm`).",
            {"field": "flange_height_mm"},
        )


def export_cookie_cutter(document: VectorDocument, options: CookieCutterOptions) -> bytes:
    """Binary STL of the cutter, `width_mm` wide before the blade and flange."""
    _check(options)
    kept = replace(
        document,
        layers=[layer for layer in document.layers if layer.palette_index not in options.exclude],
    )
    if not kept.layers:
        raise InvalidParameters("Every color is excluded.", {"field": "exclude_colors"})
    design = to_millimetres(unary_union(layer_geometries(kept)), document, options.width_mm)
    outline = cutter_outline(design, options.smooth_mm)
    if outline.is_empty:
        raise InvalidParameters(
            "The design has no outline large enough for a cookie cutter.", {"field": "svg"}
        )
    if options.mirror:
        outline = affinity.scale(outline, xfact=-1, yfact=1, origin=(0, 0))
    blade = outline.buffer(options.wall_mm) - outline
    parts: list[tuple[BaseGeometry, float, float]] = [
        (blade, options.flange_height_mm if options.flange_mm > 0 else 0.0, options.height_mm)
    ]
    if options.flange_mm > 0:
        flange = outline.buffer(options.wall_mm + options.flange_mm) - outline
        parts.insert(0, (flange, 0.0, options.flange_height_mm))
    low_x, low_y = parts[0][0].bounds[:2]
    triangles = [
        prism(polygon, bottom, top)
        for geometry, bottom, top in parts
        for polygon in without_pinches(affinity.translate(geometry, -low_x, -low_y))
    ]
    return write_stl([np.concatenate(triangles)])
