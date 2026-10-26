"""Edit SVG documents in the VectorSnap contract on the server, without a browser.

The color operations of the SVG editor for other services and scripts: merging colors
that look the same (CIEDE2000, as `merge_delta_e` of `/quantize` and the editor's
*Similar colors*), replacing colors and snapping them to the loaded filaments. Layers
that end up with the same color are joined into one, because every layer is its own
filament in a 3D print. See docs/05-api-specification.md#svg.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace

import numpy as np
from lxml import etree

from app import __version__
from app.schemas.palette import hex_to_rgb
from app.services.quantization import delta_e_2000, srgb_to_lab
from app.services.svg_geometry import (
    SVG_NS,
    VectorDocument,
    VectorShape,
    shapes_geometry,
)


@dataclass(frozen=True)
class ColorChange:
    color: str
    into: str
    delta_e: float  # CIEDE2000 between the two


@dataclass(frozen=True)
class EditedSvg:
    document: VectorDocument
    changes: list[ColorChange]


def color_delta_e(first: str, second: str) -> float:
    """CIEDE2000 difference of two `#rrggbb` colors."""
    lab = srgb_to_lab(np.array([hex_to_rgb(first), hex_to_rgb(second)], dtype=np.uint8))
    return float(delta_e_2000(lab[0], lab[1]))


def _change(color: str, into: str) -> ColorChange:
    return ColorChange(color, into, round(color_delta_e(color, into), 2))


def _number(value: float) -> str:
    return f"{value:g}"


def serialize_svg(document: VectorDocument) -> str:
    """The document in the VectorSnap contract: one `<g>` per layer, bottom to top; paths
    get a `fill` only when it differs from their layer's."""
    svg = etree.Element(
        f"{{{SVG_NS}}}svg",
        nsmap={None: SVG_NS},
        attrib={
            "viewBox": f"0 0 {_number(document.width)} {_number(document.height)}",
            "width": _number(document.width),
            "height": _number(document.height),
            "data-generator": f"vectorsnap/{__version__}",
        },
    )
    for layer in document.layers:
        index = str(layer.palette_index)
        group = etree.SubElement(
            svg,
            f"{{{SVG_NS}}}g",
            attrib={"id": f"color-{index}", "data-palette-index": index, "fill": layer.fill},
        )
        for shape in layer.shapes:
            attributes = {"id": shape.id, "data-palette-index": index, "d": shape.d}
            if shape.fill != layer.fill:
                attributes["fill"] = shape.fill
            etree.SubElement(group, f"{{{SVG_NS}}}path", attrib=attributes)
    return str(etree.tostring(svg, encoding="unicode"))


def _layer_areas(document: VectorDocument) -> list[float]:
    return [float(shapes_geometry(layer.shapes).area) for layer in document.layers]


def _join_layers(document: VectorDocument, into: dict[int, int]) -> VectorDocument:
    """Move the shapes of layer `position` on top of layer `into[position]` (positions in
    `document.layers`); shapes in their layer's color take the new layer's color."""
    moved: dict[int, list[VectorShape]] = {}
    for position, target in into.items():
        source, fill = document.layers[position], document.layers[target].fill
        moved.setdefault(target, []).extend(
            replace(shape, fill=fill) if shape.fill == source.fill else shape
            for shape in source.shapes
        )
    layers = [
        replace(layer, shapes=[*layer.shapes, *moved.get(position, [])])
        for position, layer in enumerate(document.layers)
        if position not in into
    ]
    return replace(document, layers=layers)


def merge_similar_colors(document: VectorDocument, max_delta_e: float) -> EditedSvg:
    """Join layers whose colors are closer than `max_delta_e` (CIEDE2000).

    The closest pair goes first, the layer covering less moving into the one covering
    more (which keeps its color), until no two layers are that close. Shapes with their
    own color that close to their layer's color take the layer's color.
    """
    if max_delta_e <= 0:
        return EditedSvg(document, [])
    fills = [layer.fill for layer in document.layers]
    lab = srgb_to_lab(np.array([hex_to_rgb(fill) for fill in fills], dtype=np.uint8))
    differences = delta_e_2000(lab[:, None, :], lab[None, :, :])
    differences[np.eye(len(fills), dtype=bool)] = np.inf
    into: dict[int, int] = {}
    areas: list[float] | None = None
    while len(fills) > 1:
        first, second = (int(i) for i in np.unravel_index(differences.argmin(), differences.shape))
        if differences[first, second] >= max_delta_e:
            break
        if areas is None:
            areas = _layer_areas(document)
        # Ties keep the lower layer: usually the background the rest lies on.
        kept, merged = (second, first) if areas[second] > areas[first] else (first, second)
        into[merged] = kept
        areas[kept] += areas[merged]
        differences[merged, :] = np.inf
        differences[:, merged] = np.inf
    for position, target in into.items():
        while target in into:
            target = into[target]
        into[position] = target

    joined = _join_layers(document, into)
    changes = [_change(fills[position], fills[target]) for position, target in into.items()]
    layers = []
    for layer in joined.layers:
        shapes = []
        for shape in layer.shapes:
            if shape.fill != layer.fill:
                change = _change(shape.fill, layer.fill)
                if change.delta_e < max_delta_e:
                    if change not in changes:
                        changes.append(change)
                    shape = replace(shape, fill=layer.fill)
            shapes.append(shape)
        layers.append(replace(layer, shapes=shapes))
    return EditedSvg(replace(joined, layers=layers), changes)


def _recolored(document: VectorDocument, color_of: Callable[[str], str]) -> EditedSvg:
    """Every layer and shape color replaced by `color_of(color)`; layers that end up with
    the same color are joined into the one covering most."""
    changes: dict[str, ColorChange] = {}

    def new_color(color: str) -> str:
        into = color_of(color)
        if into != color and color not in changes:
            changes[color] = _change(color, into)
        return into

    recolored = replace(
        document,
        layers=[
            replace(
                layer,
                fill=new_color(layer.fill),
                shapes=[replace(shape, fill=new_color(shape.fill)) for shape in layer.shapes],
            )
            for layer in document.layers
        ],
    )
    by_fill: dict[str, list[int]] = {}
    for position, layer in enumerate(recolored.layers):
        by_fill.setdefault(layer.fill, []).append(position)
    into: dict[int, int] = {}
    areas: list[float] | None = None
    for positions in by_fill.values():
        if len(positions) < 2:
            continue
        if areas is None:
            areas = _layer_areas(recolored)
        kept = max(positions, key=lambda position: (areas[position], -position))
        into.update({position: kept for position in positions if position != kept})
    return EditedSvg(_join_layers(recolored, into), list(changes.values()))


def recolor(
    document: VectorDocument, colors: Mapping[str, str], filaments: Sequence[str] = ()
) -> EditedSvg:
    """Replace colors of layers and shapes by `colors` (`{"#fefefe": "#ffffff"}`), then
    every color by the closest of `filaments` (CIEDE2000), if any are given, so the
    design prints with the filaments at hand."""
    mapping = {color.lower(): into.lower() for color, into in colors.items()}
    loaded = [filament.lower() for filament in filaments]
    rgb = np.array([hex_to_rgb(color) for color in loaded], dtype=np.uint8).reshape(-1, 3)
    lab = srgb_to_lab(rgb)

    def color_of(color: str) -> str:
        color = mapping.get(color, color)
        if not loaded:
            return color
        target = srgb_to_lab(np.array([hex_to_rgb(color)], dtype=np.uint8))
        return loaded[int(delta_e_2000(lab, target).argmin())]

    return _recolored(document, color_of)
