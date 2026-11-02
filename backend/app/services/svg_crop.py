"""Crop a document to its shapes on the server: trim the empty margin around a design,
or keep a set padding, so exports and prints are as large as the design itself.

The viewBox becomes the box around the shapes (those of `ignore` layers left out, e.g. a
background that fills everything) plus `padding`, and every shape moves with it. Shapes
keep their curves: they are translated, not flattened. See
docs/05-api-specification.md#post-apiv1svgcrop.
"""

from collections.abc import Collection
from dataclasses import dataclass, replace

from shapely import unary_union

from app.core.errors import InvalidParameters
from app.services.svg_geometry import VectorDocument, shape_outline
from app.services.svg_transform import transform_path


@dataclass(frozen=True)
class CroppedSvg:
    document: VectorDocument
    dx: float  # how far every shape moved
    dy: float


def crop_document(
    document: VectorDocument, padding: float = 0.0, ignore: Collection[int] = ()
) -> CroppedSvg:
    """The document cropped to its shapes (but those of the `ignore` palette indices),
    plus `padding` document px on every side."""
    counted = [
        shape_outline(shape)
        for layer in document.layers
        if layer.palette_index not in ignore
        for shape in layer.shapes
    ]
    outline = unary_union(counted) if counted else None
    if outline is None or outline.is_empty:
        raise InvalidParameters(
            "No shapes to crop to: every counted color is ignored or empty.",
            {"field": "ignore_colors"},
        )
    left, top, right, bottom = outline.bounds
    dx, dy = padding - left, padding - top
    matrix = (1.0, 0.0, 0.0, 1.0, dx, dy)
    layers = [
        replace(
            layer,
            shapes=[replace(shape, d=transform_path(shape.d, matrix)) for shape in layer.shapes],
        )
        for layer in document.layers
    ]
    cropped = replace(
        document,
        width=round(right - left + 2 * padding, 3),
        height=round(bottom - top + 2 * padding, 3),
        layers=layers,
    )
    return CroppedSvg(cropped, round(dx, 3), round(dy, 3))
