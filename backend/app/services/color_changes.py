"""Filament changes of a multi-color printer (AMS, ACE, MMU) printing a 3MF export.

A printer with one nozzle and several loaded filaments prints every layer color by color,
changing the filament in between: each change takes time (retract, cut, load) and purges
filament into a prime tower. The estimate counts the changes layer by layer like the
slicer orders them — a layer starts with the filament the previous one ended with, and
ends with one the next layer needs — so different designs and options (flat or stepped
colors, inlays, raised parts) can be compared before slicing. One filament per distinct
color, as in the 3MF (docs/13-export-formats.md#3mf); the estimate also gives how much of
each filament the model takes.
"""

from dataclasses import dataclass

from app.core.errors import InvalidParameters
from app.services.export_stl import Body, StlOptions, build_bodies, volume_mm3
from app.services.svg_geometry import VectorDocument

# PLA (g/cm³), the density Anycubic Slicer Next uses for its PLA profiles.
PLA_DENSITY = 1.24


@dataclass(frozen=True)
class ChangeCosts:
    change_s: float = 0.0  # time of one filament change
    purge_mm3: float = 0.0  # filament purged per change (flush + prime tower)
    density_g_cm3: float = PLA_DENSITY


@dataclass(frozen=True)
class FilamentUse:
    color: str
    volume_mm3: float  # solid volume of the color's bodies; the slicer's infill uses less
    grams: float


@dataclass(frozen=True)
class ColorChangeEstimate:
    filaments: list[FilamentUse]  # one per distinct color, in filament (3MF slot) order
    layers: int
    changes: int
    max_colors_per_layer: int
    change_time_s: float
    purge_mm3: float
    purge_g: float


def _layer_colors(bodies: list[Body], print_layer_mm: float) -> list[list[str]]:
    """Distinct body colors printed in every layer (by the layer's mid-height)."""
    spans = [
        (
            float(body.triangles[..., 2].min()),
            float(body.triangles[..., 2].max()),
            body.color.lower(),
        )
        for body in bodies
    ]
    height = max((top for _, top, _ in spans), default=0.0)
    layers = round(height / print_layer_mm)
    return [
        list(
            dict.fromkeys(
                color
                for bottom, top, color in spans
                if bottom < (index + 0.5) * print_layer_mm < top
            )
        )
        for index in range(layers)
    ]


def count_changes(layers: list[list[str]]) -> int:
    """Filament changes for printing the layers bottom-up, starting with a loaded filament.

    Every layer starts with the filament the previous one ended with when it needs it, and
    ends with a filament the next layer needs, so a layer of n colors costs n - 1 changes
    plus one when it has to start with a different filament.
    """
    changes, current = 0, None
    for index, colors in enumerate(layers):
        if not colors:
            continue
        if current is not None and current not in colors:
            changes += 1
        changes += len(colors) - 1
        first = current if current in colors else colors[0]
        rest = [color for color in colors if color != first]
        following = layers[index + 1] if index + 1 < len(layers) else []
        current = next((c for c in rest if c in following), rest[-1]) if rest else first
    return changes


def filament_use(bodies: list[Body], density_g_cm3: float = PLA_DENSITY) -> list[FilamentUse]:
    """Filament per distinct color (the base plate counts for its color), slot order."""
    volumes: dict[str, float] = {}
    for body in bodies:
        color = body.color.lower()
        volumes[color] = volumes.get(color, 0.0) + volume_mm3(body.triangles)
    return [
        FilamentUse(
            color=color,
            volume_mm3=round(volume, 1),
            grams=round(volume / 1000 * density_g_cm3, 2),
        )
        for color, volume in volumes.items()
    ]


def estimate_from_bodies(
    bodies: list[Body], print_layer_mm: float, costs: ChangeCosts | None = None
) -> ColorChangeEstimate:
    costs = costs or ChangeCosts()
    layers = _layer_colors(bodies, print_layer_mm)
    changes = count_changes(layers)
    purge_mm3 = changes * costs.purge_mm3
    return ColorChangeEstimate(
        filaments=filament_use(bodies, costs.density_g_cm3),
        layers=len(layers),
        changes=changes,
        max_colors_per_layer=max((len(colors) for colors in layers), default=0),
        change_time_s=round(changes * costs.change_s, 1),
        purge_mm3=round(purge_mm3, 1),
        purge_g=round(purge_mm3 / 1000 * costs.density_g_cm3, 2),
    )


def estimate_color_changes(
    document: VectorDocument, options: StlOptions, costs: ChangeCosts | None = None
) -> ColorChangeEstimate:
    if options.print_layer_mm <= 0:
        raise InvalidParameters("Counting filament changes needs print_layer_mm.")
    return estimate_from_bodies(build_bodies(document, options), options.print_layer_mm, costs)
