"""Read SVG documents in the VectorSnap contract as geometry for export formats.

The parser accepts the backend/editor output contract (docs/05-api-specification.md):
`<g data-palette-index fill>` groups with `<path id d [fill]>` children. Paths are read
with svgelements (all SVG path commands, absolute and relative) and can be flattened to
polylines or turned into Shapely polygons with even-odd hole semantics.
"""

import math
import re
from dataclasses import dataclass

import numpy as np
import svgelements
from lxml import etree
from numpy.typing import NDArray
from shapely import MultiPolygon, Polygon, affinity, make_valid, unary_union
from shapely.geometry.base import BaseGeometry

from app.core.errors import InvalidSvg

SVG_NS = "http://www.w3.org/2000/svg"
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# Maximum distance between a curve and its polyline approximation, in document px.
DEFAULT_TOLERANCE = 0.25
# Points one curve is sampled with at most: a curve thousands of px long gets them
# farther apart instead of millions of them (memory and time).
MAX_CURVE_SAMPLES = 10_000

# px per unit of an absolute SVG length (CSS: 96 px to the inch). A size in %, em or
# ex depends on where the SVG is shown, so a document sized that way needs a viewBox.
_UNITS = {
    "": 1.0,
    "px": 1.0,
    "in": 96.0,
    "cm": 96 / 2.54,
    "mm": 96 / 25.4,
    "q": 96 / 101.6,
    "pt": 96 / 72,
    "pc": 16.0,
}
_LENGTH_RE = re.compile(r"^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)\s*$")
# Coordinates and sizes beyond this many px (2.6 km at 96 dpi) are an error, not a
# document: Shapely and the exporters overflow on them (1e999 reads as infinity).
MAX_COORDINATE = 1e7
# Characters of path data quoted in an error.
_EXCERPT = 40


@dataclass(frozen=True)
class VectorShape:
    id: str
    fill: str
    d: str


@dataclass(frozen=True)
class VectorLayer:
    palette_index: int
    fill: str
    shapes: list[VectorShape]


@dataclass(frozen=True)
class VectorDocument:
    width: float
    height: float
    layers: list[VectorLayer]  # bottom to top


def _color(value: str | None, fallback: str) -> str:
    return value.lower() if value and _HEX_RE.match(value) else fallback


def _length(value: str) -> float:
    """An absolute SVG length in px: `200`, `200px`, `52.9mm`, `2in`."""
    match = _LENGTH_RE.match(value)
    if not match or match[2].lower() not in _UNITS:
        raise InvalidSvg(
            f"SVG size {value!r} is not a length in px, mm, cm, in, pt or pc: give the "
            "document a viewBox."
        )
    length = float(match[1]) * _UNITS[match[2].lower()]
    if abs(length) > MAX_COORDINATE:
        raise InvalidSvg(f"SVG size {value!r} is beyond {MAX_COORDINATE:,.0f} px.")
    return length


def _view_box(value: str) -> tuple[float, float, float, float] | None:
    """min-x, min-y, width and height of a viewBox, None without one."""
    parts = [part for part in re.split(r"[\s,]+", value.strip()) if part]
    if not parts:
        return None
    try:
        numbers = [float(part) for part in parts]
    except ValueError:
        numbers = []
    if len(numbers) != 4 or not all(abs(number) <= MAX_COORDINATE for number in numbers):
        raise InvalidSvg(
            f"viewBox {value!r} is not four numbers within {MAX_COORDINATE:,.0f}: min-x, "
            "min-y, width and height."
        )
    return numbers[0], numbers[1], numbers[2], numbers[3]


def _palette_index(value: str | None, position: int) -> int:
    try:
        return int(value) if value is not None else position
    except ValueError:
        return position


def parse_path(d: str) -> svgelements.Path:
    """Path data read by svgelements; data it cannot read is an invalid SVG."""
    try:
        return svgelements.Path(d)
    except ValueError as exc:  # a command short of its numbers, a non-number
        excerpt = d if len(d) <= _EXCERPT else d[:_EXCERPT] + "…"
        raise InvalidSvg(f"Path data cannot be read: {excerpt!r}.") from exc


def _moved(d: str, dx: float, dy: float) -> str:
    path = parse_path(d)
    path *= svgelements.Matrix.translate(dx, dy)
    return str(path.d())


def parse_svg(data: bytes) -> VectorDocument:
    """Parse an SVG document in the VectorSnap contract.

    Without a viewBox the size comes from `width` and `height`, in px or another
    absolute unit (Inkscape's `210mm`). A viewBox that does not start at 0,0 moves the
    shapes so it does: the document's coordinates always start at the top left corner.
    """
    parser = etree.XMLParser(
        resolve_entities=False, no_network=True, remove_comments=True, huge_tree=False
    )
    try:
        root = etree.fromstring(data, parser=parser)
    except etree.XMLSyntaxError as exc:
        raise InvalidSvg("SVG is not well-formed XML.") from exc
    if root.tag != f"{{{SVG_NS}}}svg":
        raise InvalidSvg("Document is not an SVG.")

    view_box = _view_box(root.get("viewBox", ""))
    if view_box is not None:
        left, top, width, height = view_box
    else:
        left = top = 0.0
        width = _length(root.get("width") or "0")
        height = _length(root.get("height") or "0")
    if not (width > 0 and height > 0):
        raise InvalidSvg("SVG must define a positive viewBox or width/height.")

    layers: list[VectorLayer] = []
    for position, group in enumerate(root.iterchildren(f"{{{SVG_NS}}}g")):
        group_fill = _color(group.get("fill"), "#000000")
        shapes = [
            VectorShape(
                id=path.get("id") or f"p-{position}-{sequence}",
                fill=_color(path.get("fill"), group_fill),
                d=_moved(path.get("d", ""), -left, -top) if left or top else path.get("d", ""),
            )
            for sequence, path in enumerate(group.iterchildren(f"{{{SVG_NS}}}path"))
            if path.get("d")
        ]
        if shapes:
            index = _palette_index(group.get("data-palette-index"), position)
            layers.append(VectorLayer(palette_index=index, fill=group_fill, shapes=shapes))

    if not layers:
        raise InvalidSvg("SVG contains no shapes.")
    return VectorDocument(width=width, height=height, layers=layers)


def _bezier_points(controls: NDArray[np.float64], tolerance: float) -> NDArray[np.float64]:
    """Sample a Bézier curve (2-4 control points) without its start point, vectorized.

    The control polygon is never shorter than the curve, so it bounds the sample count.
    """
    length = float(np.linalg.norm(np.diff(controls, axis=0), axis=1).sum())
    samples = min(MAX_CURVE_SAMPLES, max(2, math.ceil(length / tolerance)))
    t = np.linspace(0.0, 1.0, samples + 1)[1:, None]
    if len(controls) == 3:
        p0, p1, p2 = controls
        return np.asarray((1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t**2 * p2)
    p0, p1, p2, p3 = controls
    return np.asarray(
        (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t**2 * p2 + t**3 * p3
    )


def _arc_points(arc: svgelements.Arc, tolerance: float) -> NDArray[np.float64]:
    """Sample an elliptical arc without its start point, vectorized.

    The arc is drawn from its center and the two semi-diameters svgelements keeps
    (to `prx` and `pry`), which stay exact under any transform. svgelements' own curves
    take them for the ellipse's axes, which they are no longer once skewed: a circle
    under `skewX` came out a third off.
    """
    center = np.array(_xy(arc.center))
    axes = np.column_stack([np.array(_xy(arc.prx)) - center, np.array(_xy(arc.pry)) - center])
    end = np.array([_xy(arc.end)])
    turn = float(np.linalg.det(axes))
    if turn == 0 or not arc.sweep:  # flattened to a line
        return end
    cos_start, sin_start = np.linalg.solve(axes, np.array(_xy(arc.start)) - center)
    start = math.atan2(sin_start, cos_start)
    # The sweep turns from the first semi-diameter towards the second; a mirroring
    # transform swaps their order.
    sweep = float(arc.sweep) if turn > 0 else -float(arc.sweep)
    radius = float(np.linalg.norm(axes, axis=0).max())
    samples = min(MAX_CURVE_SAMPLES, max(2, math.ceil(abs(sweep) * radius / tolerance)))
    angles = start + sweep * np.linspace(0.0, 1.0, samples + 1)[1:]
    points = center + np.column_stack([np.cos(angles), np.sin(angles)]) @ axes.T
    points[-1] = end[0]
    return np.asarray(points)


def _xy(point: svgelements.Point) -> tuple[float, float]:
    x, y = float(point.x), float(point.y)
    if not (abs(x) <= MAX_COORDINATE and abs(y) <= MAX_COORDINATE):  # also NaN
        raise InvalidSvg(f"Path data has coordinates beyond {MAX_COORDINATE:,.0f} px.")
    return (x, y)


def flatten(d: str, tolerance: float = DEFAULT_TOLERANCE) -> list[NDArray[np.float64]]:
    """Approximate each subpath of a path by a closed polyline (N x 2, without repeat)."""
    return flatten_path(parse_path(d), tolerance)


def flatten_path(
    path: svgelements.Path, tolerance: float = DEFAULT_TOLERANCE
) -> list[NDArray[np.float64]]:
    """`flatten` of a path svgelements has read already."""
    return closed_rings(flatten_subpaths(path, tolerance))


def flatten_subpaths(
    path: svgelements.Path, tolerance: float = DEFAULT_TOLERANCE
) -> list[tuple[NDArray[np.float64], bool]]:
    """Each subpath of a path as the polyline it draws (N x 2, a closed one back to its
    start), and whether it is closed (`Z`): what a stroke follows."""
    lines: list[tuple[NDArray[np.float64], bool]] = []
    for subpath in path.as_subpaths():
        chunks: list[NDArray[np.float64]] = []
        closed = False
        for segment in svgelements.Path(subpath):
            if isinstance(segment, (svgelements.Move, svgelements.Line, svgelements.Close)):
                closed = closed or isinstance(segment, svgelements.Close)
                if segment.end is not None:
                    chunks.append(np.array([_xy(segment.end)]))
            elif isinstance(segment, svgelements.QuadraticBezier):
                controls = [segment.start, segment.control, segment.end]
                chunks.append(_bezier_points(np.array([_xy(p) for p in controls]), tolerance))
            elif isinstance(segment, svgelements.CubicBezier):
                controls = [segment.start, segment.control1, segment.control2, segment.end]
                chunks.append(_bezier_points(np.array([_xy(p) for p in controls]), tolerance))
            elif isinstance(segment, svgelements.Arc):
                chunks.append(_arc_points(segment, tolerance))
        if chunks:
            lines.append((np.concatenate(chunks), closed))
    return lines


def closed_rings(lines: list[tuple[NDArray[np.float64], bool]]) -> list[NDArray[np.float64]]:
    """The rings subpaths fill: every one closed (a fill closes open ones), without the
    repeated start point; those of fewer than 3 points are left out."""
    rings: list[NDArray[np.float64]] = []
    for points, _ in lines:
        ring = points
        if len(ring) > 1 and np.allclose(ring[0], ring[-1]):
            ring = ring[:-1]
        if len(ring) >= 3:
            rings.append(ring)
    return rings


Point = tuple[float, float]
# ("M", [end]), ("L", [end]), ("C", [control1, control2, end]) or ("Z", []).
PathCommand = tuple[str, list[Point]]


def curve_path(d: str) -> list[PathCommand]:
    """Path data as moves, lines, cubic Béziers and closes, without flattening.

    Quadratic curves are converted exactly to cubic ones, arcs by cubic approximation,
    so formats with only cubic curves (PDF, PostScript) keep the exact shape.
    """
    commands: list[PathCommand] = []
    for segment in parse_path(d):
        if isinstance(segment, svgelements.Move):
            commands.append(("M", [_xy(segment.end)]))
        elif isinstance(segment, svgelements.Close):
            commands.append(("Z", []))
        elif isinstance(segment, svgelements.Line):
            commands.append(("L", [_xy(segment.end)]))
        elif isinstance(segment, svgelements.CubicBezier):
            commands.append(("C", [_xy(segment.control1), _xy(segment.control2), _xy(segment.end)]))
        elif isinstance(segment, svgelements.QuadraticBezier):
            start, control, end = segment.start, segment.control, segment.end
            commands.append(
                (
                    "C",
                    [
                        _xy(start + (control - start) * (2 / 3)),
                        _xy(end + (control - end) * (2 / 3)),
                        _xy(end),
                    ],
                )
            )
        elif isinstance(segment, svgelements.Arc):
            for curve in segment.as_cubic_curves():
                commands.append(("C", [_xy(curve.control1), _xy(curve.control2), _xy(curve.end)]))
    return commands


def to_polygon(rings: list[NDArray[np.float64]]) -> BaseGeometry:
    """Combine rings with even-odd semantics (holes are rings inside other rings)."""
    geometry: BaseGeometry = Polygon()
    for ring in rings:
        polygon = make_valid(Polygon(ring))
        geometry = geometry.symmetric_difference(polygon)
    return geometry


def shape_outline(shape: VectorShape, tolerance: float = DEFAULT_TOLERANCE) -> BaseGeometry:
    """A shape's filled area as Shapely geometry, holes included (even-odd)."""
    return to_polygon(flatten(shape.d, tolerance))


def polygons(geometry: BaseGeometry) -> list[Polygon]:
    """All non-empty polygons of a geometry (flattening multi-part results)."""
    if isinstance(geometry, Polygon):
        return [] if geometry.is_empty else [geometry]
    if isinstance(geometry, MultiPolygon):
        return [p for p in geometry.geoms if not p.is_empty]
    return [p for g in getattr(geometry, "geoms", []) for p in polygons(g)]


def _coordinate(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def path_data(geometry: BaseGeometry, dx: float = 0.0, dy: float = 0.0) -> str:
    """SVG path data of a geometry's polygons, moved by (dx, dy): one closed subpath per
    ring, holes included (they read as holes with either fill rule)."""
    return " ".join(
        "M" + " L".join(f"{_coordinate(x + dx)},{_coordinate(y + dy)}" for x, y in ring[:-1]) + " Z"
        for polygon in polygons(geometry)
        for ring in [polygon.exterior.coords, *(hole.coords for hole in polygon.interiors)]
    )


# Drops near-collinear points left by flattening (straight edges traced as curves);
# in document px, i.e. far below print/cut resolution.
SIMPLIFY_TOLERANCE = 0.05


def shapes_geometry(shapes: list[VectorShape]) -> BaseGeometry:
    """United, simplified geometry of some shapes, in document px.

    Adjacent shapes merge, so exports have no internal walls or double cuts.
    """
    return unary_union([shape_outline(shape) for shape in shapes]).simplify(SIMPLIFY_TOLERANCE)


def layer_geometries(document: VectorDocument) -> list[BaseGeometry]:
    """United, simplified geometry of every layer (bottom to top), in document px."""
    return [shapes_geometry(layer.shapes) for layer in document.layers]


def to_millimetres(
    geometry: BaseGeometry, document: VectorDocument, width_mm: float
) -> BaseGeometry:
    """Scale to `width_mm` and flip the y axis (SVG y points down, CAD/print y points up)."""
    scale = width_mm / document.width
    flipped = affinity.scale(geometry, xfact=1, yfact=-1, origin=(0, document.height / 2))
    return affinity.scale(flipped, xfact=scale, yfact=scale, origin=(0, 0))
