"""Edit some shapes of a document and keep the rest: the loop every server-side edit
shares (offset, simplify, fill holes, transform, delete, knife, lasso)."""

from collections.abc import Callable, Collection, Sequence
from dataclasses import replace

from app.services.svg_geometry import VectorDocument, VectorShape

# What an edit makes of a shape: itself changed, its pieces, or nothing (removed).
Edited = VectorShape | Sequence[VectorShape] | None


def edit_shapes(
    document: VectorDocument,
    ids: Collection[str],
    edit: Callable[[VectorShape], Edited],
) -> VectorDocument:
    """`edit` every shape in `ids` (every shape without `ids`), in document order. Pieces
    take the shape's place; layers left empty are dropped, and layers without an edited
    shape stay the same objects."""
    wanted = set(ids)
    layers = []
    for layer in document.layers:
        shapes: list[VectorShape] = []
        changed = False
        for shape in layer.shapes:
            if wanted and shape.id not in wanted:
                shapes.append(shape)
                continue
            result = edit(shape)
            if result is None:
                changed = True
            elif isinstance(result, VectorShape):
                changed = changed or result is not shape
                shapes.append(result)
            else:
                changed = True
                shapes.extend(result)
        if shapes:
            layers.append(replace(layer, shapes=shapes) if changed else layer)
    return replace(document, layers=layers)
