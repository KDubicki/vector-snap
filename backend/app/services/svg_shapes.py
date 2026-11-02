"""Delete and merge shapes on the server: the SVG editor's delete and merge for services
and scripts without a browser.

Shapes are deleted by id or by size (specks and slivers left by tracing, as the editor's
"Select shapes smaller than"); merged shapes become the largest of them, as in the
editor. Layers left without shapes are removed and at least one shape stays, so the
result is still a valid document. See docs/05-api-specification.md#post-apiv1svgdelete
and #post-apiv1svgmerge.
"""

from collections.abc import Collection
from dataclasses import dataclass, replace

from shapely import unary_union

from app.core.errors import InvalidParameters
from app.services.svg_document import edit_shapes
from app.services.svg_geometry import (
    VectorDocument,
    VectorShape,
    path_data,
    shape_outline,
)


@dataclass(frozen=True)
class DeletedShapes:
    document: VectorDocument
    deleted: list[str]  # ids of the removed shapes, in document order


def shape_area(shape: VectorShape) -> float:
    """Filled area of a shape in document px² (holes excluded)."""
    return float(shape_outline(shape).area)


def delete_shapes(
    document: VectorDocument, ids: Collection[str] = (), smaller_than: float = 0.0
) -> DeletedShapes:
    """Remove the shapes in `ids` and those with an area below `smaller_than` px²."""
    remove = set(ids)

    def deleted(shape: VectorShape) -> bool:
        return shape.id in remove or (smaller_than > 0 and shape_area(shape) < smaller_than)

    gone: list[str] = []

    def edit(shape: VectorShape) -> VectorShape | None:
        if not deleted(shape):
            return shape
        gone.append(shape.id)
        return None

    edited = edit_shapes(document, (), edit)
    if not edited.layers:
        raise InvalidParameters("This would delete every shape; keep at least one.")
    return DeletedShapes(edited, gone)


@dataclass(frozen=True)
class MergedShapes:
    document: VectorDocument
    id: str  # the merged shape: the largest one's id
    merged: list[str]  # ids of the shapes united into it, in document order


def merge_shapes(document: VectorDocument, ids: Collection[str]) -> MergedShapes:
    """Unite the shapes in `ids` into one: adjacent ones fuse into one outline, apart ones
    become subpaths. It keeps the id, layer, own color and position of the largest shape,
    so merging slivers into a main shape keeps the main shape. Curves become polylines."""
    wanted = set(ids)
    shapes = [shape for layer in document.layers for shape in layer.shapes if shape.id in wanted]
    if len(shapes) < 2:
        raise InvalidParameters("Send at least two shape `ids` to merge.", {"field": "ids"})
    geometries = [shape_outline(shape) for shape in shapes]
    united = unary_union(geometries)
    if united.is_empty:
        raise InvalidParameters("The shapes have no area to merge.", {"field": "ids"})

    largest = max(range(len(shapes)), key=lambda i: geometries[i].area)
    keep = shapes[largest]
    merged = [shape for shape in shapes if shape is not keep]
    kept = replace(keep, d=path_data(united))
    gone = {id(shape) for shape in merged}  # by identity: equal shapes may repeat
    layers = [
        replace(
            layer,
            shapes=[
                kept if shape is keep else shape for shape in layer.shapes if id(shape) not in gone
            ],
        )
        for layer in document.layers
    ]
    return MergedShapes(
        replace(document, layers=[layer for layer in layers if layer.shapes]),
        keep.id,
        [shape.id for shape in merged],
    )
