"""Details of a 3D model too thin for the printer's nozzle.

A nozzle cannot lay down lines narrower than itself: the slicer skips them, and the
3D exports drop them with `min_feature_mm`. The check finds the shapes that are mostly
(or wholly) thinner than the nozzle where they print — thin lettering, hairlines,
specks — so they can be thickened, the model made wider or a finer nozzle chosen
before slicing. See docs/13-export-formats.md#print-check.
"""

from dataclasses import dataclass

from app.services.base_plate import printable
from app.services.model_options import StlOptions
from app.services.model_parts import shape_footprints
from app.services.svg_geometry import VectorDocument

# A shape is reported when at least this share of its printed area is too thin.
THIN_SHARE = 0.5
# Areas below this (mm²) count as nothing: float noise of the geometry operations.
AREA_EPSILON_MM2 = 1e-6


@dataclass(frozen=True)
class ThinShape:
    shape_id: str
    palette_index: int
    color: str
    area_mm2: float  # printed area of the shape
    thin_mm2: float  # of it narrower than the nozzle
    vanishes: bool  # nothing of the shape is wide enough to print


@dataclass(frozen=True)
class PrintCheck:
    nozzle_mm: float
    shapes: list[ThinShape]  # most thin area first
    thin_mm2: float  # thin area of the whole design


def check_print(document: VectorDocument, options: StlOptions, nozzle_mm: float) -> PrintCheck:
    """Shapes of the model narrower than `nozzle_mm` where they print, for `options`
    (heights, left-out colors, mirror, size); `min_feature_mm` is not applied."""
    thin: list[ThinShape] = []
    total = 0.0
    for footprint in shape_footprints(document, options):
        area = footprint.geometry.area
        if area < AREA_EPSILON_MM2:
            continue
        kept = printable(footprint.geometry, nozzle_mm).area
        lost = max(0.0, area - kept)
        total += lost
        if lost >= THIN_SHARE * area:
            thin.append(
                ThinShape(
                    shape_id=footprint.shape_id,
                    palette_index=footprint.palette_index,
                    color=footprint.color,
                    area_mm2=round(area, 3),
                    thin_mm2=round(lost, 3),
                    vanishes=kept < AREA_EPSILON_MM2,
                )
            )
    thin.sort(key=lambda shape: -shape.thin_mm2)
    return PrintCheck(nozzle_mm=nozzle_mm, shapes=thin, thin_mm2=round(total, 3))
