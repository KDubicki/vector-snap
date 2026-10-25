"""Options of the 3D model exports (STL, 3MF, filament plan, estimates) and its bodies.

Shared by `export_stl`, which builds the bodies, and the services that package or
measure them. See docs/13-export-formats.md.
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from numpy.typing import NDArray

from app.services.base_plate import BaseShape, LoopPosition

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


def snap_to_layers(height: float, print_layer_mm: float) -> float:
    """Round a positive height to whole printer layers, keeping at least one layer.

    Heights of 0 stay 0 (no base / color left out); `print_layer_mm` 0 disables snapping.
    """
    if print_layer_mm <= 0 or height <= 0:
        return height
    # Half up, with a little slack for float error (0.3 / 0.2 = 1.4999...).
    layers = max(1, math.floor(height / print_layer_mm + 0.5 + 1e-9))
    return round(layers * print_layer_mm, 6)
