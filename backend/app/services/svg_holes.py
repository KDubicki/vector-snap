"""Fill small holes in shapes on the server: pin holes and specks of transparency that
tracing leaves inside a color, which print as tiny gaps and cut as tiny parts.

A hole is a subpath inside another one (even-odd). Holes smaller than `smaller_than`
document px² are filled when they are empty — other shapes cover less than half of
them — so a hole that another color fills (an eye in a face) stays. The hole's subpath
is dropped from the path data, with any island inside it, and every other subpath is
kept as it was, curves included. See docs/05-api-specification.md#post-apiv1svgfill-holes.
"""

from collections.abc import Callable, Collection
from dataclasses import dataclass, replace
from functools import partial

import numpy as np
import svgelements
from numpy.typing import NDArray
from shapely import Polygon, STRtree, contains, points, prepare

from app.services.svg_document import edit_shapes
from app.services.svg_geometry import VectorDocument, VectorShape, flatten, parse_path

# A hole counts as empty while other shapes cover less than this share of it.
EMPTY_SHARE = 0.5


@dataclass(frozen=True)
class FilledHoles:
    document: VectorDocument
    filled: int  # holes filled
    shapes: list[str]  # ids of the shapes that lost holes, in document order


def _subpaths(d: str) -> list[tuple[str, Polygon | None]]:
    """Each subpath's path data and its outline (None for one without area)."""
    result: list[tuple[str, Polygon | None]] = []
    for subpath in parse_path(d).as_subpaths():
        data = svgelements.Path(subpath).d()
        rings = flatten(data)
        result.append((data, Polygon(rings[0]) if rings else None))
    return result


def _fill(
    shape: VectorShape, smaller_than: float, covered: Callable[[Polygon], float]
) -> tuple[str, int] | None:
    """The shape's path data without its small empty holes, and how many there were;
    `covered` tells the share of a hole other shapes cover."""
    parts = _subpaths(shape.d)
    outlines = [
        outline if outline is not None and outline.is_valid else None for _, outline in parts
    ]
    small = [i for i, outline in enumerate(outlines) if outline and outline.area < smaller_than]
    if not small:
        return None
    present = [i for i, outline in enumerate(outlines) if outline is not None]
    prepared = np.array([outlines[i] for i in present], dtype=object)
    prepare(prepared)
    tree = STRtree(prepared)
    dropped: set[int] = set()
    filled = 0
    for i in small:
        outline = outlines[i]
        if outline is None or i in dropped:
            continue
        point = outline.representative_point()
        around = [k for k in tree.query(point) if contains(prepared[k], point)]
        depth = sum(1 for k in around if present[k] != i)
        if depth % 2 == 0 or covered(outline) >= EMPTY_SHARE:
            continue
        filled += 1
        dropped.add(i)
        # Islands inside the hole would turn into holes: they are filled with it.
        dropped.update(
            present[k] for k in tree.query(outline, predicate="contains") if present[k] != i
        )
    if not filled:
        return None
    return " ".join(data for i, (data, _) in enumerate(parts) if i not in dropped), filled


# Points sampled across a hole (per side of a grid) to measure how much others cover it.
SAMPLE_GRID = 6


class _Coverage:
    """Which shapes cover points, from every ring of every shape: a point is inside a shape
    when it lies inside an odd number of its rings (even-odd, as `to_polygon`). Answers
    without building the shapes' outlines, which is slow for a background holding a hole
    for every motif."""

    def __init__(self, shapes: list[VectorShape]) -> None:
        rings = [(index, ring) for index, shape in enumerate(shapes) for ring in flatten(shape.d)]
        self.owner = np.array([index for index, _ in rings], dtype=np.intp)
        self.rings = np.array([Polygon(ring) for _, ring in rings], dtype=object)
        prepare(self.rings)  # point-in-polygon tests on large rings stay fast
        self.tree = STRtree(self.rings)

    def share(self, hole: Polygon, shape_index: int) -> float:
        """Share of the hole that shapes other than `shape_index` cover (sampled)."""
        points = _samples(hole)
        point_index, ring_index = self.tree.query(points)
        inside = contains(self.rings[ring_index], points[point_index])
        point_index, ring_index = point_index[inside], ring_index[inside]
        owners = self.owner[ring_index]
        others = owners != shape_index
        pairs, counts = np.unique(
            np.stack([point_index[others], owners[others]]), axis=1, return_counts=True
        )
        covered = np.unique(pairs[0][counts % 2 == 1])
        return len(covered) / len(points)


def _samples(hole: Polygon) -> NDArray[np.object_]:
    """A grid of points inside the hole, and one point surely inside it."""
    left, top, right, bottom = hole.bounds
    xs = np.linspace(left, right, SAMPLE_GRID + 2)[1:-1]
    ys = np.linspace(top, bottom, SAMPLE_GRID + 2)[1:-1]
    grid = points(np.array([(x, y) for x in xs for y in ys]))
    inside = grid[contains(hole, grid)]
    return np.append(inside, hole.representative_point())


def fill_holes(
    document: VectorDocument, smaller_than: float, ids: Collection[str] = ()
) -> FilledHoles:
    """Fill the empty holes below `smaller_than` px² in the shapes in `ids` (every shape
    without `ids`)."""
    shapes = [shape for layer in document.layers for shape in layer.shapes]
    coverage = _Coverage(shapes)
    position = {id(shape): index for index, shape in enumerate(shapes)}  # equal shapes repeat
    filled_holes = 0
    changed: list[str] = []

    def edit(shape: VectorShape) -> VectorShape:
        nonlocal filled_holes
        covered = partial(coverage.share, shape_index=position[id(shape)])
        result = _fill(shape, smaller_than, covered)
        if result is None:
            return shape
        d, filled = result
        filled_holes += filled
        changed.append(shape.id)
        return replace(shape, d=d)

    return FilledHoles(edit_shapes(document, ids, edit), filled_holes, changed)
