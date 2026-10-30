"""Which shapes of a vector document print, and where: the parts of a 3D model.

Colors are stacked in document order or by brightness and each gets its height above
the base plate (per color, per shape, snapped to printer layers; 0 leaves it out). A
color's shapes are grouped by height into parts, scaled to millimetres (mirrored and
simplified as asked), and each part's printed footprint is what shapes drawn above it
leave uncovered. `export_stl` builds the bodies from these parts; `print_check` reads the
footprints. See docs/13-export-formats.md.
"""

from dataclasses import dataclass

from shapely import affinity, make_valid
from shapely.geometry.base import BaseGeometry

from app.services.model_options import StackOrder, StlOptions, snap_to_layers
from app.services.svg_geometry import (
    VectorDocument,
    VectorLayer,
    VectorShape,
    shapes_geometry,
    to_millimetres,
)


def relative_luminance(hex_color: str) -> float:
    """WCAG relative luminance of a `#rrggbb` color: 0 (black) to 1 (white)."""
    channels = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def stack_layers[T](layers: list[T], fills: list[str], order: StackOrder) -> list[T]:
    """`layers` bottom to top in `order`; equally bright colors keep the document order."""
    if order == "document":
        return layers
    sign = 1 if order == "dark_to_light" else -1
    ranked = sorted(range(len(layers)), key=lambda i: sign * relative_luminance(fills[i]))
    return [layers[i] for i in ranked]


def base_height(options: StlOptions) -> float:
    return snap_to_layers(options.base_mm, options.print_layer_mm)


def layer_height(position: int, palette_index: int, options: StlOptions) -> float:
    """Extrusion height above the base for the layer at `position` (bottom = 0)."""
    if palette_index in options.layer_heights:
        height = options.layer_heights[palette_index]
    else:
        height = options.layer_mm * (position + 1 if options.layered else 1)
    return snap_to_layers(height, options.print_layer_mm)


def repaired(geometry: BaseGeometry) -> BaseGeometry:
    """Valid geometry: scaling rounds coordinates, which can make nearly touching rings
    (e.g. chains of sliver holes) cross; GEOS cannot triangulate such polygons."""
    return geometry if geometry.is_valid else make_valid(geometry)


def in_millimetres(
    geometry: BaseGeometry, document: VectorDocument, options: StlOptions
) -> BaseGeometry:
    """Scale (and mirror) document-px geometry to the model, repairing rounding damage."""
    result = to_millimetres(geometry, document, options.width_mm)
    if options.mirror:
        result = affinity.scale(result, xfact=-1, yfact=1, origin=(options.width_mm / 2, 0))
    result = repaired(result)
    if options.simplify_mm > 0:
        result = repaired(result.simplify(options.simplify_mm))
    return result


@dataclass(frozen=True)
class Part:
    """Shapes of one color extruded to one height above the base."""

    layer: VectorLayer
    shapes: tuple[VectorShape, ...]
    geometry: BaseGeometry  # millimetres
    height: float
    own_height: bool  # shapes with a height of their own (`shape_heights`)


def included_parts(document: VectorDocument, options: StlOptions) -> list[Part]:
    """Included parts, bottom color first: per color, its shapes grouped by height."""
    layers = stack_layers(
        document.layers, [layer.fill for layer in document.layers], options.stack_order
    )
    parts: list[Part] = []
    for position, layer in enumerate(layers):
        color_height = layer_height(position, layer.palette_index, options)
        groups: dict[float | None, list[VectorShape]] = {}
        for shape in layer.shapes:
            own = options.shape_heights.get(shape.id)
            height = None if own is None else snap_to_layers(own, options.print_layer_mm)
            # Shapes at their color's height merge with it (no walls between them).
            groups.setdefault(None if height == color_height else height, []).append(shape)
        for key, shapes in groups.items():
            height = color_height if key is None else key
            if height > 0:
                geometry = in_millimetres(shapes_geometry(shapes), document, options)
                parts.append(Part(layer, tuple(shapes), geometry, height, key is not None))
    return parts


OVERLAP_TOLERANCE_MM2 = 1e-6


def visible_footprints(document: VectorDocument, parts: list[Part]) -> list[BaseGeometry]:
    """Each part's geometry without the areas covered by shapes drawn above it.

    Shapes above in the document (later layers) own their footprint, as in the SVG: a
    shape moved or a fragment placed onto other shapes would otherwise print as bodies
    overlapping in the same space (slicers resolve that inconsistently). Traced colors
    overlap the ones below them by a pixel, so their seams have no gaps.
    """
    order = {id(layer): position for position, layer in enumerate(document.layers)}
    by_drawing = sorted(range(len(parts)), key=lambda i: order[id(parts[i].layer)])
    visible: list[BaseGeometry] = [part.geometry for part in parts]
    covered: BaseGeometry | None = None
    for index in reversed(by_drawing):
        geometry = parts[index].geometry
        if (
            covered is not None
            and geometry.intersects(covered)
            and geometry.intersection(covered).area > OVERLAP_TOLERANCE_MM2
        ):
            visible[index] = repaired(geometry.difference(covered))
        covered = geometry if covered is None else covered.union(geometry)
    return visible


@dataclass(frozen=True)
class ShapeFootprint:
    """The area of one shape that prints: its color's, without what is drawn above it."""

    shape_id: str
    palette_index: int
    color: str
    geometry: BaseGeometry  # millimetres, before thin details are dropped


def shape_footprints(document: VectorDocument, options: StlOptions) -> list[ShapeFootprint]:
    """Every included shape's printed area, bottom color first."""
    parts = included_parts(document, options)
    footprints: list[ShapeFootprint] = []
    for part, visible in zip(parts, visible_footprints(document, parts), strict=True):
        for shape in part.shapes:
            geometry = in_millimetres(shapes_geometry([shape]), document, options)
            if visible is not part.geometry:  # partly covered by shapes drawn above
                geometry = repaired(geometry.intersection(visible))
            layer = part.layer
            footprints.append(ShapeFootprint(shape.id, layer.palette_index, layer.fill, geometry))
    return footprints


def design_outline(document: VectorDocument, options: StlOptions) -> list[BaseGeometry]:
    """Every shape of the design, whatever its height: the area an engraving is cut into."""
    shapes = [shape for layer in document.layers for shape in layer.shapes]
    return [in_millimetres(shapes_geometry(shapes), document, options)] if shapes else []
