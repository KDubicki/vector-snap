"""Export a vector document as a 3D model (binary STL) for printing.

Each color layer is extruded to its own height on top of an optional base plate, so a
multi-color design prints as a relief (or, with `layered=False`, all colors share one
height). Heights can be set per color (0 leaves a color out) and the model mirrored;
details thinner than the nozzle can be removed and outlines simplified before extrusion,
heights can be rounded to whole printer layers and colors kept apart by a gap. The base
plate follows the design's outline or is a rectangle, rounded rectangle or circle around
it, optionally with a raised rim along its edge; colors can be stacked in document order
or by brightness. A hanging loop can be added at the top of the base plate, a magnet
pocket in its underside, and its first layer inset against elephant's foot. With
`relief="inlay"` the colors are set into the base plate instead, flush with its top;
with `relief="engrave"` they are only cut out of it — lettering made of missing
filament, a single-filament print — down to their height, or through the plate.
Coordinates are converted to millimetres and the y axis is flipped (SVG y points down,
STL z-up models are viewed from above with y up). The meshes come from `mesh`, the base
plate from `base_plate`. `export_stl_parts` puts every body in an STL file of its own.
See docs/13-export-formats.md.
"""

import io
import math
import zipfile
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from shapely import Polygon, affinity, make_valid, unary_union
from shapely.geometry.base import BaseGeometry

from app.core.errors import InvalidParameters
from app.services.base_plate import (
    MAGNET_ROOF_MM,
    BaseShape,
    LoopPosition,
    base_outline,
    magnet_pocket,
    printable,
    rim,
    screw_holes,
    with_loop,
)
from app.services.mesh import StlFormat, footed_prism, prism, without_pinches, write_stl
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
# Colors stand on the base plate (`raised`) or are set into it, flush with its top (`inlay`).
Relief = Literal["raised", "inlay", "engrave"]
# Where the model sits: the design's coordinates (`corner`: x and y from 0) or with the
# middle of its footprint at x = y = 0 (`center`), e.g. for CAD or CNC tools.
Origin = Literal["corner", "center"]


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
    # Simplify outlines: drop points that deviate less than this from them (mm); fewer
    # triangles and smaller files for traced photos. 0 keeps the outlines exact.
    simplify_mm: float = 0.0
    # Gap between neighbouring colors (mm): every color shrinks by half of it, for parts
    # printed separately and fitted together (inlays, puzzles) or to stop colors bleeding.
    color_gap_mm: float = 0.0
    # Printer layer height (mm): the base and every color end on a layer boundary; 0 = off.
    print_layer_mm: float = 0.0
    # Shape of the base plate and how far it extends beyond the design (mm).
    base_shape: BaseShape = "outline"
    base_margin_mm: float = 0.0
    stack_order: StackOrder = "document"
    # `inlay`: every color is sunk its height into the base plate, flush with the top.
    relief: Relief = "raised"
    origin: Origin = "corner"
    # Raised rim along the edge of the base plate: width and height above the base (mm);
    # a height of 0 makes it as high as the tallest color. Colors under it are cut away.
    rim_mm: float = 0.0
    rim_height_mm: float = 0.0
    # Hole diameter of a hanging loop on the base plate (keyrings, hooks); 0 = none,
    # and the side of the plate it sticks out of.
    loop_hole_mm: float = 0.0
    loop_position: LoopPosition = "top"
    # Round pockets in the underside of the base plate for magnets (diameter, depth; mm)
    # and how many, spread along the plate's longer side.
    magnet_mm: float = 0.0
    magnet_count: int = 1
    magnet_depth_mm: float = 2.0
    # Screw holes through the base plate beside the design: 0, 2 or 4 (mm diameter).
    screw_holes: int = 0
    screw_hole_mm: float = 4.0
    # Outlines along every color's edges, in a filament of their own: width (mm, 0 = none),
    # color, and height above the base (0 = as high as the tallest color).
    outline_mm: float = 0.0
    outline_color: str = "#000000"
    outline_height_mm: float = 0.0
    # Elephant's foot compensation (mm): the first printer layer of the base plate is
    # inset by this much, as the squashed first layer bulges out; 0 = off.
    elephant_foot_mm: float = 0.0
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
    result = _repaired(result)
    if options.simplify_mm > 0:
        result = _repaired(result.simplify(options.simplify_mm))
    return result


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
            visible[index] = _repaired(geometry.difference(covered))
        covered = geometry if covered is None else covered.union(geometry)
    return visible


@dataclass(frozen=True)
class ModelSize:
    x_mm: float
    y_mm: float
    z_mm: float


def model_size(document: VectorDocument, options: StlOptions) -> ModelSize:
    """Bounding box of the exported model — base plate, rim and loop included — to check it
    against a printer's build volume."""
    points = np.concatenate(
        [body.triangles.reshape(-1, 3) for body in build_bodies(document, options)]
    )
    x, y, z = (points.max(axis=0) - points.min(axis=0)).round(3).tolist()
    return ModelSize(x_mm=x, y_mm=y, z_mm=z)


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
    _check_options(options, base)
    # Top of the solid plate: inlaid colors take the plate's upper part.
    plate_top = base - _deepest_inlay(included, base, options)
    _check_magnet(options, base, plate_top)
    engrave = options.relief == "engrave"
    base_color = _plate_color(document, included, options)
    plate = _BasePlate(Polygon(), Polygon())
    bodies: list[Body] = []
    if base > 0:
        plate = _base_plate(document, included, options)
        parts = [
            _plate(polygon, plate_top, plate.pocket, options)
            for polygon in (without_pinches(plate.silhouette) if plate_top > 0 else [])
        ]
        # Cut through (an engraving as deep as the plate): no solid plate below the cuts.
        if parts:
            bodies.append(Body("base", base_color, np.concatenate(parts)))
    silhouette, border = plate.silhouette, plate.border
    visible = _visible(document, included)
    if not border.is_empty:
        visible = [_repaired(geometry.difference(border)) for geometry in visible]
    outline = _outline(visible, options)
    if not outline.is_empty:
        visible = [_repaired(geometry.difference(outline)) for geometry in visible]
    if options.color_gap_mm > 0:
        visible = [_with_gap(geometry, options.color_gap_mm) for geometry in visible]
    if plate_top < base:
        bodies.extend(_inlay_bands(silhouette, included, visible, base, base_color, options))
    if not engrave:  # an engraving leaves the cut colors empty
        make_bodies = _filament_bodies if options.filaments else _color_bodies
        bodies.extend(make_bodies(included, visible, base, options))
    if not border.is_empty:
        bodies.extend(_rim_body(border, included, base, base_color, options))
    if not outline.is_empty:
        bodies.extend(_outline_body(outline, included, base, options))
    if not bodies:
        raise InvalidParameters(
            f"Nothing to export: every shape is thinner than {options.min_feature_mm:g} mm.",
            {"field": "min_feature_mm"},
        )
    return _placed(bodies, options.origin)


def _check_options(options: StlOptions, base: float) -> None:
    """Reject option combinations that cannot be built, naming the field to change."""
    engrave = options.relief == "engrave"
    if engrave and options.filaments:
        raise InvalidParameters(
            "An engraving is one filament: it cannot use mixed colors.", {"field": "filaments"}
        )
    if engrave and base <= 0:
        raise InvalidParameters(
            "An engraving needs a base plate to cut into (base_mm > 0).", {"field": "base_mm"}
        )
    if options.loop_hole_mm > 0 and base <= 0:
        raise InvalidParameters(
            "A hanging loop needs a base plate (base_mm > 0).", {"field": "loop_hole_mm"}
        )
    if options.screw_holes not in (0, 2, 4):
        raise InvalidParameters("Screw holes come in 2 or 4.", {"field": "screw_holes"})
    if options.screw_holes and base <= 0:
        raise InvalidParameters(
            "Screw holes need a base plate (base_mm > 0).", {"field": "screw_holes"}
        )
    if options.outline_mm > 0 and (options.relief != "raised" or options.filaments):
        raise InvalidParameters(
            "Outlines stand on the base plate: they need raised colors, not inlaid, "
            "engraved or mixed ones.",
            {"field": "outline_mm"},
        )
    if options.rim_mm > 0 and base <= 0:
        raise InvalidParameters("A rim needs a base plate (base_mm > 0).", {"field": "rim_mm"})
    if options.elephant_foot_mm > 0 and base <= 0:
        raise InvalidParameters(
            "Elephant's foot compensation needs a base plate (base_mm > 0).",
            {"field": "elephant_foot_mm"},
        )


def _check_magnet(options: StlOptions, base: float, plate_top: float) -> None:
    """The magnet pockets fit in the solid plate below the inlaid colors, with a roof."""
    if options.magnet_mm > 0 and options.magnet_depth_mm > plate_top - MAGNET_ROOF_MM + 1e-9:
        raise InvalidParameters(
            f"A {options.magnet_depth_mm:g} mm deep magnet pocket needs a base plate of at "
            f"least {options.magnet_depth_mm + MAGNET_ROOF_MM:g} mm"
            + (" below the inlaid colors." if plate_top < base else "."),
            {"field": "magnet_depth_mm"},
        )


@dataclass(frozen=True)
class _BasePlate:
    """The base plate's outline (with loop, without screw holes), its rim and pockets."""

    silhouette: BaseGeometry
    border: BaseGeometry  # the rim; empty without one
    pocket: BaseGeometry | None = None  # magnet pockets


def _base_plate(document: VectorDocument, parts: list[_Part], options: StlOptions) -> _BasePlate:
    """Outline of the base plate under the design, with its rim, loop, holes and pockets."""
    engrave = options.relief == "engrave"
    outline = _design_outline(document, options) if engrave else [p.geometry for p in parts]
    design = printable(unary_union(outline), options.min_feature_mm)
    silhouette = base_outline(design, options.base_shape, options.base_margin_mm)
    border = rim(silhouette, options.rim_mm)
    silhouette = with_loop(silhouette, options.loop_hole_mm, options.loop_position)
    holes = screw_holes(silhouette, design, options.screw_holes, options.screw_hole_mm)
    if holes is not None:
        silhouette = _repaired(silhouette.difference(holes))
        border = _repaired(border.difference(holes))
    pocket = magnet_pocket(silhouette, options.magnet_mm, options.magnet_count)
    return _BasePlate(silhouette, border, pocket)


def _placed(bodies: list[Body], origin: Origin) -> list[Body]:
    """Bodies moved so the middle of their footprint is at x = y = 0 for `center`."""
    if origin == "corner":
        return bodies
    points = np.concatenate([body.triangles for body in bodies]).reshape(-1, 3)
    low, high = points[:, :2].min(axis=0), points[:, :2].max(axis=0)
    shift = np.array([*((low + high) / 2), 0.0])
    return [Body(body.name, body.color, body.triangles - shift) for body in bodies]


def _design_outline(document: VectorDocument, options: StlOptions) -> list[BaseGeometry]:
    """Every shape of the design, whatever its height: the area an engraving is cut into."""
    shapes = [shape for layer in document.layers for shape in layer.shapes]
    return [_in_millimetres(shapes_geometry(shapes), document, options)] if shapes else []


def _plate_color(document: VectorDocument, parts: list[_Part], options: StlOptions) -> str:
    """The base plate's filament: the first loaded filament for mixed colors, the bottom
    color left solid for an engraving, else the bottom printed color."""
    if options.filaments:
        return options.filaments[0]
    if options.relief == "engrave":
        cut = {id(part.layer) for part in parts}
        layers = stack_layers(
            document.layers, [layer.fill for layer in document.layers], options.stack_order
        )
        solid = [layer for layer in layers if id(layer) not in cut and layer.shapes]
        if solid:
            return solid[0].fill
    return parts[0].layer.fill


def _bottom(part: _Part, base: float, options: StlOptions) -> float:
    """Where a part starts: on top of the base plate, or sunk its height into it."""
    return base - part.height if options.relief == "inlay" else base


def _deepest_inlay(parts: list[_Part], base: float, options: StlOptions) -> float:
    """How deep the inlaid or engraved colors reach into the base plate (0 for raised
    colors). An engraving may go through the plate."""
    if options.relief == "raised":
        return 0.0
    deepest = max(part.height for part in parts)
    if options.relief == "engrave":
        if deepest > base + 1e-9:
            raise InvalidParameters(
                f"Engraved colors cannot be deeper than the base plate ({base:g} mm); the "
                f"deepest is {deepest:g} mm. As deep as the plate cuts through.",
                {"field": "base_mm"},
            )
        return deepest
    if deepest > base - 1e-9:
        raise InvalidParameters(
            f"Inlaid colors need a base plate thicker than the deepest color ({deepest:g} mm); "
            f"it is {base:g} mm.",
            {"field": "base_mm"},
        )
    return deepest


def _inlay_bands(
    silhouette: BaseGeometry,
    parts: list[_Part],
    visible: list[BaseGeometry],
    base: float,
    color: str,
    options: StlOptions,
) -> list[Body]:
    """The plate's upper part around inlaid colors: one body per depth band, each the
    plate minus the colors reaching that deep (stacked closed prisms stay separate
    bodies, as a body made of touching solids would not be manifold)."""
    bodies: list[Body] = []
    upper = 0.0
    for depth in sorted({part.height for part in parts}):
        reaching = [g for part, g in zip(parts, visible, strict=True) if part.height >= depth]
        holes = printable(unary_union(reaching), options.min_feature_mm)
        bottom, top = round(base - depth, 6), round(base - upper, 6)
        prisms = [
            prism(polygon, bottom, top)
            for polygon in without_pinches(_repaired(silhouette.difference(holes)))
        ]
        if prisms:
            bodies.append(Body(f"base-{bottom:g}-{top:g}mm", color, np.concatenate(prisms)))
        upper = depth
    return bodies


# First layer height assumed for elephant's foot compensation without `print_layer_mm`.
FIRST_LAYER_MM = 0.2


def _plate(
    polygon: Polygon, base: float, pocket: BaseGeometry | None, options: StlOptions
) -> NDArray[np.float64]:
    """One polygon of the base plate, with the magnet pockets that lie in it and the
    first layer inset by `elephant_foot_mm` (polygons too thin for it stay as they are)."""
    depth = options.magnet_depth_mm
    inset: list[Polygon] = []
    if options.elephant_foot_mm > 0:
        shrunk = polygon.buffer(-options.elephant_foot_mm, join_style="mitre")
        inset = without_pinches(_repaired(shrunk))
    if not inset:
        return prism(polygon, 0.0, base, pocket, depth)
    foot = min(options.print_layer_mm or FIRST_LAYER_MM, base)
    if foot < base:
        return footed_prism(polygon, inset, foot, base, pocket, depth)
    # A one-layer plate is all first layer.
    return np.concatenate([prism(piece, 0.0, base, pocket, depth) for piece in inset])


def _with_gap(geometry: BaseGeometry, gap_mm: float) -> BaseGeometry:
    """Shrink by half the gap, keeping corners sharp, so neighbours end `gap_mm` apart."""
    return _repaired(geometry.buffer(-gap_mm / 2, join_style="mitre"))


def _color_bodies(
    parts: list[_Part], visible: list[BaseGeometry], base: float, options: StlOptions
) -> list[Body]:
    """One body per color and height."""
    bodies: list[Body] = []
    for part, geometry in zip(parts, visible, strict=True):
        shapes = without_pinches(printable(geometry, options.min_feature_mm))
        bottom = _bottom(part, base, options)
        prisms = [prism(polygon, bottom, bottom + part.height) for polygon in shapes]
        if prisms:
            name = f"color-{part.layer.palette_index}"
            if part.own_height:
                name += f"-{part.height:g}mm"
            bodies.append(Body(name, part.layer.fill, np.concatenate(prisms)))
    return bodies


def _rim_body(
    border: BaseGeometry, parts: list[_Part], base: float, color: str, options: StlOptions
) -> list[Body]:
    """The rim, in the base plate's color, as high as asked or as the tallest color."""
    height = options.rim_height_mm or max(part.height for part in parts)
    top = base + snap_to_layers(height, options.print_layer_mm)
    prisms = [prism(polygon, base, top) for polygon in without_pinches(border)]
    return [Body("rim", color, np.concatenate(prisms))] if prisms else []


def _outline(visible: list[BaseGeometry], options: StlOptions) -> BaseGeometry:
    """The band `outline_mm` wide along every color's edges, inside the design: centered on
    the edge between two colors, inside the design along its outer edge. Parts narrower
    than the nozzle are dropped. Empty without outlines."""
    if options.outline_mm <= 0 or not visible:
        return Polygon()
    design = unary_union(visible)
    half = options.outline_mm / 2
    edges = unary_union([geometry.boundary for geometry in visible]).buffer(half, quad_segs=8)
    rim_band = design.difference(design.buffer(-options.outline_mm, quad_segs=8))
    band = edges.intersection(design).union(rim_band)
    return _repaired(printable(band, options.min_feature_mm))


def _outline_body(
    outline: BaseGeometry, parts: list[_Part], base: float, options: StlOptions
) -> list[Body]:
    """The outlines in their own filament, as high as asked or as the tallest color."""
    height = options.outline_height_mm or max(part.height for part in parts)
    top = base + snap_to_layers(height, options.print_layer_mm)
    prisms = [prism(polygon, base, top) for polygon in without_pinches(outline)]
    return [Body("outline", options.outline_color, np.concatenate(prisms))] if prisms else []


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
        lift = _bottom(part, base, options) - base  # heights above the plate's top
        for filament, bottom, top in stack_slabs(stack, part.height, options.print_layer_mm):
            slab = (filament, round(lift + bottom, 6), round(lift + top, 6))
            slabs.setdefault(slab, []).append(geometry)
    bodies: list[Body] = []
    for filament, bottom, top in sorted(slabs, key=lambda slab: (slab[1], slab[2], slab[0])):
        geometry = unary_union(slabs[filament, bottom, top])
        shapes = without_pinches(printable(geometry, options.min_feature_mm))
        prisms = [prism(polygon, base + bottom, base + top) for polygon in shapes]
        if prisms:
            # Inlaid ranges are named by their depth below the plate's top.
            span = f"{bottom:g}-{top:g}" if bottom >= 0 else f"inlay-{-top:g}-{-bottom:g}"
            name = f"filament-{filament + 1}-{span}mm"
            bodies.append(Body(name, options.filaments[filament], np.concatenate(prisms)))
    return bodies


def export_stl(
    document: VectorDocument, options: StlOptions, stl_format: StlFormat = "binary"
) -> bytes:
    """Extrude every color layer and return an STL (units: millimetres)."""
    return write_stl([body.triangles for body in build_bodies(document, options)], stl_format)


def filament_slots(bodies: list[Body]) -> list[str]:
    """Filament colors (lowercase) in slot order: one per distinct color, the base plate's
    first — the filaments of the 3MF and of `colors.txt`."""
    return list(dict.fromkeys(body.color.lower() for body in bodies))


def volume_mm3(triangles: NDArray[np.float64]) -> float:
    """Volume enclosed by a closed, outward-oriented mesh."""
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6)


def export_stl_parts(
    document: VectorDocument, options: StlOptions, stl_format: StlFormat = "binary"
) -> bytes:
    """One STL per body (base plate, rim, each color and height) in a ZIP.

    For slicers and printers that do not read colored 3MF parts: load all files as one
    multi-part object and give each part its filament. File names keep the bodies'
    bottom-to-top order and color; `colors.txt` lists them, tab-separated: file, color,
    filament (as numbered in the 3MF), lowest and highest z and volume.
    """
    buffer = io.BytesIO()
    lines = []
    bodies = build_bodies(document, options)
    slots = {color: index + 1 for index, color in enumerate(filament_slots(bodies))}
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for number, body in enumerate(bodies, start=1):
            name = f"{number:02d}-{body.name}-{body.color[1:]}.stl"
            archive.writestr(name, write_stl([body.triangles], stl_format))
            z = body.triangles[..., 2]
            columns = [
                name,
                body.color,
                str(slots[body.color.lower()]),
                f"{float(z.min()):g}",
                f"{float(z.max()):g}",
                f"{volume_mm3(body.triangles):.1f}",
            ]
            lines.append("\t".join(columns))
        archive.writestr("colors.txt", "\n".join(lines) + "\n")
    return buffer.getvalue()
