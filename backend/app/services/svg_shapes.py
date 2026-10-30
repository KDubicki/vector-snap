"""Delete shapes on the server: the SVG editor's delete for services and scripts without
a browser.

Shapes go by id or by size (specks and slivers left by tracing, as the editor's "Select
shapes smaller than"); layers left without shapes are removed. At least one shape stays,
so the result is still a valid document. See
docs/05-api-specification.md#post-apiv1svgdelete.
"""

from collections.abc import Collection
from dataclasses import dataclass, replace

from app.core.errors import InvalidParameters
from app.services.svg_geometry import VectorDocument, VectorShape, flatten, to_polygon


@dataclass(frozen=True)
class DeletedShapes:
    document: VectorDocument
    deleted: list[str]  # ids of the removed shapes, in document order


def shape_area(shape: VectorShape) -> float:
    """Filled area of a shape in document px² (holes excluded)."""
    return float(to_polygon(flatten(shape.d)).area)


def delete_shapes(
    document: VectorDocument, ids: Collection[str] = (), smaller_than: float = 0.0
) -> DeletedShapes:
    """Remove the shapes in `ids` and those with an area below `smaller_than` px²."""
    remove = set(ids)

    def deleted(shape: VectorShape) -> bool:
        return shape.id in remove or (smaller_than > 0 and shape_area(shape) < smaller_than)

    gone: list[str] = []
    layers = []
    for layer in document.layers:
        kept = []
        for shape in layer.shapes:
            if deleted(shape):
                gone.append(shape.id)
            else:
                kept.append(shape)
        if kept:
            layers.append(layer if len(kept) == len(layer.shapes) else replace(layer, shapes=kept))
    if not layers:
        raise InvalidParameters("This would delete every shape; keep at least one.")
    return DeletedShapes(replace(document, layers=layers), gone)
