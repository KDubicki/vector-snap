"""Statistics of an SVG document for scripts and services: how many colors and shapes it
has, how much of the image each color covers and how many specks tracing left, before
choosing filaments or cleaning it up with /svg/delete or /svg/merge-similar. See
docs/05-api-specification.md#post-apiv1svgstats.
"""

from dataclasses import dataclass

from app.services.svg_geometry import VectorDocument, shapes_geometry
from app.services.svg_shapes import shape_area


@dataclass(frozen=True)
class LayerStats:
    palette_index: int
    color: str
    shapes: int
    own_colors: int  # shapes with a color of their own
    area_px2: float  # the layer's shapes united (overlaps counted once)
    share: float  # of the document area
    specks: int  # shapes smaller than the speck area


@dataclass(frozen=True)
class SvgStats:
    width: float
    height: float
    layers: list[LayerStats]  # bottom to top

    @property
    def shapes(self) -> int:
        return sum(layer.shapes for layer in self.layers)

    @property
    def specks(self) -> int:
        return sum(layer.specks for layer in self.layers)


def svg_stats(document: VectorDocument, speck_area: float = 25.0) -> SvgStats:
    """Per color layer: shapes, own colors, covered area and share, and specks (shapes with
    a filled area below `speck_area` px²)."""
    total = document.width * document.height
    layers = []
    for layer in document.layers:
        area = float(shapes_geometry(layer.shapes).area)
        layers.append(
            LayerStats(
                palette_index=layer.palette_index,
                color=layer.fill,
                shapes=len(layer.shapes),
                own_colors=sum(shape.fill != layer.fill for shape in layer.shapes),
                area_px2=round(area, 2),
                share=round(min(area / total, 1.0), 4),
                specks=sum(shape_area(shape) < speck_area for shape in layer.shapes),
            )
        )
    return SvgStats(document.width, document.height, layers)
