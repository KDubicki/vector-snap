"""Filament change plan for printing a layered 3D export on a single-extruder printer.

With one extruder a multi-color relief is printed by pausing at the height where one
color ends and swapping the filament: everything printed above that height comes out in
the next color, so the top face of every color region gets its own color. The plan is
derived from the exported bodies, so it reflects every export option (per-color heights,
left-out colors, removed details, layer snapping). See docs/13-export-formats.md.
"""

from dataclasses import dataclass

from app.services.export_stl import Body, StlOptions, build_bodies
from app.services.svg_geometry import VectorDocument

# Heights closer than this (mm) count as the same layer boundary.
_EPSILON_MM = 1e-6


@dataclass(frozen=True)
class FilamentStep:
    z_mm: float  # height where this color starts
    color: str
    layer: int | None  # first printer layer in this color (1-based), if the layer is known


@dataclass(frozen=True)
class FilamentConflict:
    z_mm: float  # several colors end at this height
    colors: list[str]


@dataclass(frozen=True)
class FilamentPlan:
    steps: list[FilamentStep]  # the first step is the starting filament at z = 0
    conflicts: list[FilamentConflict]
    height_mm: float


def _top(body: Body) -> float:
    return float(body.triangles[..., 2].max())


def _layer(z_mm: float, print_layer_mm: float) -> int | None:
    if print_layer_mm <= 0:
        return None
    return round(z_mm / print_layer_mm) + 1


def plan_from_bodies(bodies: list[Body], print_layer_mm: float = 0.0) -> FilamentPlan:
    """Build the plan from exported bodies (base plate first, then one per color).

    Bodies are printed bottom-up; the color of a band between two consecutive tops is the
    color of the bodies ending at the upper one. Different colors ending at the same height
    cannot be separated by filament changes and are reported as conflicts.
    """
    tops: dict[float, list[str]] = {}
    for body in bodies:
        top = _top(body)
        key = next((t for t in tops if abs(t - top) < _EPSILON_MM), top)
        if body.color not in tops.setdefault(key, []):
            tops[key].append(body.color)

    steps: list[FilamentStep] = []
    conflicts: list[FilamentConflict] = []
    start = 0.0
    for top in sorted(tops):
        colors = tops[top]
        if len(colors) > 1:
            conflicts.append(FilamentConflict(z_mm=round(top, 6), colors=colors))
        if not steps or steps[-1].color != colors[0]:
            z = round(start, 6)
            steps.append(FilamentStep(z_mm=z, color=colors[0], layer=_layer(z, print_layer_mm)))
        start = top
    return FilamentPlan(steps=steps, conflicts=conflicts, height_mm=round(start, 6))


def filament_plan(document: VectorDocument, options: StlOptions) -> FilamentPlan:
    return plan_from_bodies(build_bodies(document, options), options.print_layer_mm)
