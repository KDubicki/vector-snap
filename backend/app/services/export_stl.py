"""Export a vector document as a 3D model (binary STL) for printing.

Each color layer is extruded to its own height on top of an optional base plate, so a
multi-color design prints as a relief (or, with `layered=False`, all colors share one
height). Heights can be set per color (0 leaves a color out) and the model mirrored;
details thinner than the nozzle can be removed before extrusion, and heights can be
rounded to whole printer layers. The base plate follows the design's outline or is a
rectangle, rounded rectangle or circle around it; colors can be stacked in document order
or by brightness. A hanging loop can be added at the top of the base plate and a magnet
pocket in its underside.
Coordinates are converted to millimetres and the y axis is flipped (SVG y points down,
STL z-up models are viewed from above with y up). The meshes come from `mesh`, the base
plate from `base_plate`. See docs/13-export-formats.md.
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from shapely import affinity, make_valid, unary_union
from shapely.geometry.base import BaseGeometry

from app.core.errors import InvalidParameters
from app.services.base_plate import (
    MAGNET_ROOF_MM,
    BaseShape,
    base_outline,
    magnet_pocket,
    printable,
    with_loop,
)
from app.services.mesh import prism, without_pinches, write_binary_stl
from app.services.svg_geometry import (
    VectorDocument,
    VectorLayer,
    VectorShape,
    shapes_geometry,
    to_millimetres,
)

# Bottom-to-top order of the color layers: as in the SVG (largest coverage at the bottom)
# or by brightness.
StackOrder = Literal["document", "light_to_dark", "dark_to_light"]


@dataclass(frozen=True)
class ColorStack:
    """Filaments of one color from its top surface down (mixed colors).

    `top` lists (filament index, thickness in mm) from the top surface down: thin layers
    of translucent filament over `base`, which fills the rest of the color's height.
    Seen from above they blend into colors the filaments do not have on their own.
    """

    base: int
    top: tuple[tuple[int, float], ...] = ()


@dataclass(frozen=True)
class StlOptions:
    width_mm: float = 100.0
    base_mm: float = 1.0
    layer_mm: float = 1.0
    layered: bool = True
    # Height above the base per palette index (mm); 0 leaves the color out. Colors not
    # listed follow `layer_mm` / `layered`.
    layer_heights: Mapping[int, float] = field(default_factory=dict)
    # Height above the base per shape id (mm), overriding its color: raised or lowered
    # elements; 0 leaves the shape out. Unknown ids are ignored.
    shape_heights: Mapping[str, float] = field(default_factory=dict)
    # Mirror horizontally (stamps, printing the top face down).
    mirror: bool = False
    # Remove parts narrower than this (mm), e.g. the nozzle width; 0 keeps everything.
    min_feature_mm: float = 0.0
    # Printer layer height (mm): the base and every color end on a layer boundary; 0 = off.
    print_layer_mm: float = 0.0
    # Shape of the base plate and how far it extends beyond the design (mm).
    base_shape: BaseShape = "outline"
    base_margin_mm: float = 0.0
    stack_order: StackOrder = "document"
    # Hole diameter of a hanging loop on top of the base plate (keyrings, hooks); 0 = none.
    loop_hole_mm: float = 0.0
    # Round pocket in the underside of the base plate for a magnet (diameter, depth; mm).
    magnet_mm: float = 0.0
    magnet_depth_mm: float = 2.0
    # Mixed colors: the loaded filaments ("#rrggbb", the first one prints the base plate)
    # and per palette index the filaments of that color (`ColorStack`). Bodies are then
    # one per filament and height range instead of one per color.
    filaments: tuple[str, ...] = ()
    color_stacks: Mapping[int, ColorStack] = field(default_factory=dict)


@dataclass(frozen=True)
class Body:
    """One printable part: the base plate or the extrusion of one color layer."""

    name: str
    color: str  # "#rrggbb"; the base plate uses the bottom layer's color
    triangles: NDArray[np.float64]  # N x 3 x 3, millimetres


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


def snap_to_layers(height: float, print_layer_mm: float) -> float:
    """Round a positive height to whole printer layers, keeping at least one layer.

    Heights of 0 stay 0 (no base / color left out); `print_layer_mm` 0 disables snapping.
    """
    if print_layer_mm <= 0 or height <= 0:
        return height
    # Half up, with a little slack for float error (0.3 / 0.2 = 1.4999...).
    layers = max(1, math.floor(height / print_layer_mm + 0.5 + 1e-9))
    return round(layers * print_layer_mm, 6)


def base_height(options: StlOptions) -> float:
    return snap_to_layers(options.base_mm, options.print_layer_mm)


def layer_height(position: int, palette_index: int, options: StlOptions) -> float:
    """Extrusion height above the base for the layer at `position` (bottom = 0)."""
    if palette_index in options.layer_heights:
        height = options.layer_heights[palette_index]
    else:
        height = options.layer_mm * (position + 1 if options.layered else 1)
    return snap_to_layers(height, options.print_layer_mm)


def _repaired(geometry: BaseGeometry) -> BaseGeometry:
    """Valid geometry: scaling rounds coordinates, which can make nearly touching rings
    (e.g. chains of sliver holes) cross; GEOS cannot triangulate such polygons."""
    return geometry if geometry.is_valid else make_valid(geometry)


def _in_millimetres(
    geometry: BaseGeometry, document: VectorDocument, options: StlOptions
) -> BaseGeometry:
    """Scale (and mirror) document-px geometry to the model, repairing rounding damage."""
    result = to_millimetres(geometry, document, options.width_mm)
    if options.mirror:
        result = affinity.scale(result, xfact=-1, yfact=1, origin=(options.width_mm / 2, 0))
    return _repaired(result)


@dataclass(frozen=True)
class _Part:
    """Shapes of one color extruded to one height above the base."""

    layer: VectorLayer
    geometry: BaseGeometry  # millimetres
    height: float
    own_height: bool  # shapes with a height of their own (`shape_heights`)


def _parts(document: VectorDocument, options: StlOptions) -> list[_Part]:
    """Included parts, bottom color first: per color, its shapes grouped by height."""
    layers = stack_layers(
        document.layers, [layer.fill for layer in document.layers], options.stack_order
    )
    parts: list[_Part] = []
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
                geometry = _in_millimetres(shapes_geometry(shapes), document, options)
                parts.append(_Part(layer, geometry, height, key is not None))
    return parts


OVERLAP_TOLERANCE_MM2 = 1e-6


def _visible(document: VectorDocument, parts: list[_Part]) -> list[BaseGeometry]:
    """Each part's geometry without the areas covered by shapes drawn above it.

    Shapes above in the document (later layers) own their footprint, as in the SVG: a
    shape moved or a fragment placed onto other shapes would otherwise print as bodies
    overlapping in the same space (slicers resolve that inconsistently). Traced designs
    rarely overlap, so they are left as they are.
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
            visible[index] = _repaired(geometry.difference(covered))
        covered = geometry if covered is None else covered.union(geometry)
    return visible


def build_bodies(document: VectorDocument, options: StlOptions) -> list[Body]:
    """Base plate (under the included shapes) and one extruded body per color and height.

    Shapes with a height of their own (`shape_heights`) become separate bodies of their
    color, so every body stays a closed prism. Bodies never overlap: areas covered by
    shapes drawn above are cut out of the shapes below.
    """
    included = _parts(document, options)
    if not included:
        raise InvalidParameters("Nothing to export: every color has height 0.")
    if options.filaments:
        _check_stacks(included, options)

    base = base_height(options)
    if options.loop_hole_mm > 0 and base <= 0:
        raise InvalidParameters(
            "A hanging loop needs a base plate (base_mm > 0).", {"field": "loop_hole_mm"}
        )
    if options.magnet_mm > 0 and options.magnet_depth_mm > base - MAGNET_ROOF_MM + 1e-9:
        raise InvalidParameters(
            f"A {options.magnet_depth_mm:g} mm deep magnet pocket needs a base plate of at "
            f"least {options.magnet_depth_mm + MAGNET_ROOF_MM:g} mm.",
            {"field": "magnet_depth_mm"},
        )
    bodies: list[Body] = []
    if base > 0:
        silhouette = printable(
            unary_union([part.geometry for part in included]), options.min_feature_mm
        )
        silhouette = base_outline(silhouette, options.base_shape, options.base_margin_mm)
        silhouette = with_loop(silhouette, options.loop_hole_mm)
        pocket = magnet_pocket(silhouette, options.magnet_mm)
        parts = [
            prism(polygon, 0.0, base, pocket, options.magnet_depth_mm)
            if pocket is not None and pocket.within(polygon)
            else prism(polygon, 0.0, base)
            for polygon in without_pinches(silhouette)
        ]
        if parts:
            base_color = options.filaments[0] if options.filaments else included[0].layer.fill
            bodies.append(Body("base", base_color, np.concatenate(parts)))
    visible = _visible(document, included)
    make_bodies = _filament_bodies if options.filaments else _color_bodies
    bodies.extend(make_bodies(included, visible, base, options))
    if not bodies:
        raise InvalidParameters(
            f"Nothing to export: every shape is thinner than {options.min_feature_mm:g} mm.",
            {"field": "min_feature_mm"},
        )
    return bodies


def _color_bodies(
    parts: list[_Part], visible: list[BaseGeometry], base: float, options: StlOptions
) -> list[Body]:
    """One body per color and height."""
    bodies: list[Body] = []
    for part, geometry in zip(parts, visible, strict=True):
        shapes = without_pinches(printable(geometry, options.min_feature_mm))
        prisms = [prism(polygon, base, base + part.height) for polygon in shapes]
        if prisms:
            name = f"color-{part.layer.palette_index}"
            if part.own_height:
                name += f"-{part.height:g}mm"
            bodies.append(Body(name, part.layer.fill, np.concatenate(prisms)))
    return bodies


def _check_stacks(parts: list[_Part], options: StlOptions) -> None:
    """Every included color needs a stack of loaded filaments."""
    for part in parts:
        index = part.layer.palette_index
        stack = options.color_stacks.get(index)
        if stack is None:
            raise InvalidParameters(
                f"`color_stacks` has no filaments for color {index}.",
                {"field": "color_stacks", "key": str(index)},
            )
        if any(
            not 0 <= f < len(options.filaments) for f in (stack.base, *(f for f, _ in stack.top))
        ):
            raise InvalidParameters(
                f"`color_stacks` of color {index} uses a filament that is not loaded.",
                {"field": "color_stacks", "key": str(index)},
            )


def stack_slabs(
    stack: ColorStack, height: float, print_layer_mm: float
) -> list[tuple[int, float, float]]:
    """(filament, bottom, top) ranges above the base of a color `height` mm tall.

    The top layers come first (snapped to printer layers); a color too low for all of them
    keeps the topmost ones, the base filament fills what is left below.
    """
    slabs: list[tuple[int, float, float]] = []
    top = height
    for filament, thickness in stack.top:
        if top <= 0:
            break
        bottom = max(0.0, round(top - snap_to_layers(thickness, print_layer_mm), 6))
        slabs.append((filament, bottom, top))
        top = bottom
    if top > 0:
        slabs.append((stack.base, 0.0, top))
    return slabs


def _filament_bodies(
    parts: list[_Part], visible: list[BaseGeometry], base: float, options: StlOptions
) -> list[Body]:
    """One body per filament and height range, from every color that has it there."""
    slabs: dict[tuple[int, float, float], list[BaseGeometry]] = {}
    for part, geometry in zip(parts, visible, strict=True):
        stack = options.color_stacks[part.layer.palette_index]
        for slab in stack_slabs(stack, part.height, options.print_layer_mm):
            slabs.setdefault(slab, []).append(geometry)
    bodies: list[Body] = []
    for filament, bottom, top in sorted(slabs, key=lambda slab: (slab[1], slab[2], slab[0])):
        geometry = unary_union(slabs[filament, bottom, top])
        shapes = without_pinches(printable(geometry, options.min_feature_mm))
        prisms = [prism(polygon, base + bottom, base + top) for polygon in shapes]
        if prisms:
            name = f"filament-{filament + 1}-{bottom:g}-{top:g}mm"
            bodies.append(Body(name, options.filaments[filament], np.concatenate(prisms)))
    return bodies


def export_stl(document: VectorDocument, options: StlOptions) -> bytes:
    """Extrude every color layer and return a binary STL (units: millimetres)."""
    return write_binary_stl([body.triangles for body in build_bodies(document, options)])
