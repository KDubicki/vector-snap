"""Mixed colors: colors printed as stacks of loaded filaments instead of one each.

Every color of the design gets a `ColorStack`: thin layers of translucent filament over
a base filament, which blend into colors the filaments do not have on their own. The
bodies are one per filament and height range, from every color that has that filament
there. Used by `export_stl` when `StlOptions.filaments` is set. See
docs/13-export-formats.md.
"""

from collections.abc import Iterable
from dataclasses import dataclass

import numpy as np
from shapely import unary_union
from shapely.geometry.base import BaseGeometry

from app.core.errors import InvalidParameters
from app.services.base_plate import printable
from app.services.mesh import prism, without_pinches
from app.services.model_options import Body, ColorStack, StlOptions, snap_to_layers


@dataclass(frozen=True)
class ColorPiece:
    """Shapes of one color at one height, as they print (covered areas cut away)."""

    palette_index: int
    lift: float  # where the piece starts relative to the plate's top (< 0 for inlays)
    height: float
    geometry: BaseGeometry  # millimetres


def check_stacks(palette_indices: Iterable[int], options: StlOptions) -> None:
    """Every included color needs a stack of loaded filaments."""
    for index in palette_indices:
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


def filament_bodies(pieces: Iterable[ColorPiece], base: float, options: StlOptions) -> list[Body]:
    """One body per filament and height range, from every color that has it there."""
    slabs: dict[tuple[int, float, float], list[BaseGeometry]] = {}
    for piece in pieces:
        stack = options.color_stacks[piece.palette_index]
        for filament, bottom, top in stack_slabs(stack, piece.height, options.print_layer_mm):
            slab = (filament, round(piece.lift + bottom, 6), round(piece.lift + top, 6))
            slabs.setdefault(slab, []).append(piece.geometry)
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
