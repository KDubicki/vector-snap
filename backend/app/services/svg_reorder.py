"""Reorder the color layers of a document on the server: which color lies on which.

Layers are drawn bottom to top, so the order decides what covers what (in `stacked`
tracing and after moving shapes) and, for 3D prints in document order, which color sits
lowest. The order is given explicitly or sorted: by brightness, or the largest layer at
the bottom (a background below the rest). See
docs/05-api-specification.md#post-apiv1svgreorder.
"""

from collections.abc import Sequence
from dataclasses import replace
from typing import Literal

from app.core.errors import InvalidParameters
from app.services.model_parts import stack_layers
from app.services.svg_geometry import VectorDocument, shapes_geometry

LayerSort = Literal["light_to_dark", "dark_to_light", "largest_first"]


def reorder_layers(
    document: VectorDocument, order: Sequence[int] = (), sort: LayerSort | None = None
) -> VectorDocument:
    """The document with its layers in `order` (palette indices, bottom to top, every
    layer once) or sorted by `sort`; equal layers keep their order."""
    layers = document.layers
    if sort == "largest_first":
        areas = [shapes_geometry(layer.shapes).area for layer in layers]
        ranked = sorted(range(len(layers)), key=lambda i: -areas[i])
        return replace(document, layers=[layers[i] for i in ranked])
    if sort is not None:
        return replace(
            document, layers=stack_layers(layers, [layer.fill for layer in layers], sort)
        )
    present = [layer.palette_index for layer in layers]
    if sorted(order) != sorted(present):
        raise InvalidParameters(
            f"`order` must list every palette index of the SVG once: {sorted(present)}.",
            {"field": "order"},
        )
    by_index = {layer.palette_index: layer for layer in layers}
    return replace(document, layers=[by_index[index] for index in order])
