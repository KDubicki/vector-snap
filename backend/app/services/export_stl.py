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
STL z-up models are viewed from above with y up). The options and bodies are defined in
`model_options`, the parts per color and height in `model_parts` (checked by
`model_checks`), the meshes come from `mesh`, the base plate from `base_plate` and the
filament stacks of mixed colors from `mixed_colors`. `export_stl_parts` puts every body
in an STL file of its own.
See docs/13-export-formats.md.
"""

import io
import math
import zipfile
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from shapely import Polygon, unary_union
from shapely.geometry.base import BaseGeometry

from app.core.errors import InvalidParameters
from app.services.base_plate import (
    base_outline,
    magnet_pocket,
    printable,
    rim,
    screw_holes,
    with_loop,
)
from app.services.mesh import StlFormat, footed_prism, prism, without_pinches, write_stl
from app.services.mixed_colors import ColorPiece, check_stacks, filament_bodies
from app.services.model_checks import check_magnet, check_options, deepest_inlay
from app.services.model_options import Body, Origin, StlOptions, snap_to_layers
from app.services.model_parts import (
    Part,
    base_height,
    design_outline,
    included_parts,
    repaired,
    stack_layers,
    visible_footprints,
)
from app.services.svg_geometry import VectorDocument, polygons


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


def build_bodies(
    document: VectorDocument, options: StlOptions, clip: BaseGeometry | None = None
) -> list[Body]:
    """Base plate (under the included shapes) and one extruded body per color and height.

    Shapes with a height of their own (`shape_heights`) become separate bodies of their
    color, so every body stays a closed prism. Bodies never overlap: areas covered by
    shapes drawn above are cut out of the shapes below. With `clip` (millimetres, before
    `origin` moves the model) only that part of the model is built, as if cut out of the
    whole one: a tile (`tiles`); a clip the model misses gives no bodies.
    """
    included = included_parts(document, options)
    if not included:
        raise InvalidParameters("Nothing to export: every color has height 0.")
    if options.filaments:
        check_stacks((part.layer.palette_index for part in included), options)

    base = base_height(options)
    check_options(options, base)
    # Top of the solid plate: inlaid colors take the plate's upper part.
    plate_top = base - deepest_inlay(included, base, options)
    check_magnet(options, base, plate_top)
    engrave = options.relief == "engrave"
    base_color = _plate_color(document, included, options)
    plate = _BasePlate(Polygon(), Polygon())
    bodies: list[Body] = []
    if base > 0:
        plate = _base_plate(document, included, options)
        if clip is not None:
            plate = _BasePlate(
                repaired(plate.silhouette.intersection(clip)),
                repaired(plate.border.intersection(clip)),
                _clipped_pockets(plate.pocket, clip),
            )
        parts = [
            _plate(polygon, plate_top, plate.pocket, options)
            for polygon in (without_pinches(plate.silhouette) if plate_top > 0 else [])
        ]
        # Cut through (an engraving as deep as the plate): no solid plate below the cuts.
        if parts:
            bodies.append(Body("base", base_color, np.concatenate(parts)))
    silhouette, border = plate.silhouette, plate.border
    visible = visible_footprints(document, included)
    if not border.is_empty:
        visible = [repaired(geometry.difference(border)) for geometry in visible]
    outline = _outline(visible, options)
    if not outline.is_empty:
        visible = [repaired(geometry.difference(outline)) for geometry in visible]
    if options.color_gap_mm > 0:
        visible = [_with_gap(geometry, options.color_gap_mm) for geometry in visible]
    if clip is not None:  # after the outlines and gaps, which follow the whole design
        visible = [repaired(geometry.intersection(clip)) for geometry in visible]
        outline = repaired(outline.intersection(clip))
    if plate_top < base:
        bodies.extend(_inlay_bands(silhouette, included, visible, base, base_color, options))
    # An engraving leaves the cut colors empty.
    if not engrave and options.filaments:
        pieces = [
            ColorPiece(
                part.layer.palette_index, _bottom(part, base, options) - base, part.height, geometry
            )
            for part, geometry in zip(included, visible, strict=True)
        ]
        bodies.extend(filament_bodies(pieces, base, options))
    elif not engrave:
        bodies.extend(_color_bodies(included, visible, base, options))
    if not border.is_empty:
        bodies.extend(_rim_body(border, included, base, base_color, options))
    if not outline.is_empty:
        bodies.extend(_outline_body(outline, included, base, options))
    if not bodies and clip is not None:
        return []
    if not bodies:
        raise InvalidParameters(
            f"Nothing to export: every shape is thinner than {options.min_feature_mm:g} mm.",
            {"field": "min_feature_mm"},
        )
    if clip is None:
        bodies = _copied(bodies, options.copies, options.copy_gap_mm)
    return _placed(bodies, options.origin)


def copy_grid(copies: int) -> tuple[int, int]:
    """Columns and rows for `copies`, as square as possible, wider than deep."""
    columns = math.ceil(math.sqrt(copies))
    return columns, math.ceil(copies / columns)


def _copied(bodies: list[Body], copies: int, gap: float) -> list[Body]:
    """Every body repeated `copies` times in a grid, left to right and front to back,
    `gap` apart: each body keeps its color and holds all its copies, so the 3MF still has
    one part per filament."""
    if copies <= 1:
        return bodies
    points = np.concatenate([body.triangles for body in bodies]).reshape(-1, 3)
    width, depth = points[:, :2].max(axis=0) - points[:, :2].min(axis=0)
    columns, _ = copy_grid(copies)
    shifts = [
        np.array([column * (width + gap), row * (depth + gap), 0.0])
        for row, column in (divmod(copy, columns) for copy in range(copies))
    ]
    return [
        Body(body.name, body.color, np.concatenate([body.triangles + shift for shift in shifts]))
        for body in bodies
    ]


@dataclass(frozen=True)
class _BasePlate:
    """The base plate's outline (with loop, without screw holes), its rim and pockets."""

    silhouette: BaseGeometry
    border: BaseGeometry  # the rim; empty without one
    pocket: BaseGeometry | None = None  # magnet pockets


def _clipped_pockets(pocket: BaseGeometry | None, clip: BaseGeometry) -> BaseGeometry | None:
    """The magnet pockets wholly inside the clip: one crossed by its edge is left out."""
    if pocket is None:
        return None
    inside = [part for part in polygons(pocket) if clip.contains_properly(part)]
    return unary_union(inside) if inside else None


def _base_plate(document: VectorDocument, parts: list[Part], options: StlOptions) -> _BasePlate:
    """Outline of the base plate under the design, with its rim, loop, holes and pockets."""
    engrave = options.relief == "engrave"
    outline = design_outline(document, options) if engrave else [p.geometry for p in parts]
    design = printable(unary_union(outline), options.min_feature_mm)
    silhouette = base_outline(design, options.base_shape, options.base_margin_mm)
    border = rim(silhouette, options.rim_mm)
    silhouette = with_loop(silhouette, options.loop_hole_mm, options.loop_position)
    holes = screw_holes(silhouette, design, options.screw_holes, options.screw_hole_mm)
    if holes is not None:
        silhouette = repaired(silhouette.difference(holes))
        border = repaired(border.difference(holes))
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


def _plate_color(document: VectorDocument, parts: list[Part], options: StlOptions) -> str:
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


def _bottom(part: Part, base: float, options: StlOptions) -> float:
    """Where a part starts: on top of the base plate, or sunk its height into it."""
    return base - part.height if options.relief == "inlay" else base


def _inlay_bands(
    silhouette: BaseGeometry,
    parts: list[Part],
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
            for polygon in without_pinches(repaired(silhouette.difference(holes)))
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
        inset = without_pinches(repaired(shrunk))
    if not inset:
        return prism(polygon, 0.0, base, pocket, depth)
    foot = min(options.print_layer_mm or FIRST_LAYER_MM, base)
    if foot < base:
        return footed_prism(polygon, inset, foot, base, pocket, depth)
    # A one-layer plate is all first layer.
    return np.concatenate([prism(piece, 0.0, base, pocket, depth) for piece in inset])


def _with_gap(geometry: BaseGeometry, gap_mm: float) -> BaseGeometry:
    """Shrink by half the gap, keeping corners sharp, so neighbours end `gap_mm` apart."""
    return repaired(geometry.buffer(-gap_mm / 2, join_style="mitre"))


def _color_bodies(
    parts: list[Part], visible: list[BaseGeometry], base: float, options: StlOptions
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
    border: BaseGeometry, parts: list[Part], base: float, color: str, options: StlOptions
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
    return repaired(printable(band, options.min_feature_mm))


def _outline_body(
    outline: BaseGeometry, parts: list[Part], base: float, options: StlOptions
) -> list[Body]:
    """The outlines in their own filament, as high as asked or as the tallest color."""
    height = options.outline_height_mm or max(part.height for part in parts)
    top = base + snap_to_layers(height, options.print_layer_mm)
    prisms = [prism(polygon, base, top) for polygon in without_pinches(outline)]
    return [Body("outline", options.outline_color, np.concatenate(prisms))] if prisms else []


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
