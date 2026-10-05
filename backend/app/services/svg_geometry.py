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


def parse_svg(data: bytes) -> VectorDocument:
    """Parse an SVG document in the VectorSnap contract."""
    parser = etree.XMLParser(
        resolve_entities=False, no_network=True, remove_comments=True, huge_tree=False
    )
    try:
        root = etree.fromstring(data, parser=parser)
    except etree.XMLSyntaxError as exc:
        raise InvalidSvg("SVG is not well-formed XML.") from exc
    if root.tag != f"{{{SVG_NS}}}svg":
        raise InvalidSvg("Document is not an SVG.")

    view_box = [float(v) for v in re.split(r"[\s,]+", root.get("viewBox", "").strip()) if v]
    width = view_box[2] if len(view_box) == 4 else float(root.get("width", "0") or 0)
    height = view_box[3] if len(view_box) == 4 else float(root.get("height", "0") or 0)
    if width <= 0 or height <= 0:
        raise InvalidSvg("SVG must define a positive viewBox or width/height.")

    layers: list[VectorLayer] = []
    for position, group in enumerate(root.iterchildren(f"{{{SVG_NS}}}g")):
        group_fill = _color(group.get("fill"), "#000000")
        shapes = [
            VectorShape(
                id=path.get("id") or f"p-{position}-{sequence}",
                fill=_color(path.get("fill"), group_fill),
                d=path.get("d", ""),
            )
            for sequence, path in enumerate(group.iterchildren(f"{{{SVG_NS}}}path"))
            if path.get("d")
        ]
        if shapes:
            index = int(group.get("data-palette-index", position))
            layers.append(VectorLayer(palette_index=index, fill=group_fill, shapes=shapes))

    if not layers:
        raise InvalidSvg("SVG contains no shapes.")
    return VectorDocument(width=width, height=height, layers=layers)


def _bezier_points(controls: NDArray[np.float64], tolerance: float) -> NDArray[np.float64]:
    """Sample a Bézier curve (2-4 control points) without its start point, vectorized.

    The control polygon is never shorter than the curve, so it bounds the sample count.
    """
    length = float(np.linalg.norm(np.diff(controls, axis=0), axis=1).sum())
    t = np.linspace(0.0, 1.0, max(2, math.ceil(length / tolerance)) + 1)[1:, None]
    if len(controls) == 3:
        p0, p1, p2 = controls
        return np.asarray((1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t**2 * p2)
    p0, p1, p2, p3 = controls
    return np.asarray(
        (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t**2 * p2 + t**3 * p3
    )


def _xy(point: svgelements.Point) -> tuple[float, float]:
    return (float(point.x), float(point.y))


def flatten(d: str, tolerance: float = DEFAULT_TOLERANCE) -> list[NDArray[np.float64]]:
    """Approximate each subpath of a path by a closed polyline (N x 2, without repeat)."""
    rings: list[NDArray[np.float64]] = []
    for subpath in svgelements.Path(d).as_subpaths():
        chunks: list[NDArray[np.float64]] = []
        for segment in svgelements.Path(subpath):
            if isinstance(segment, (svgelements.Move, svgelements.Line, svgelements.Close)):
                if segment.end is not None:
                    chunks.append(np.array([_xy(segment.end)]))
            elif isinstance(segment, svgelements.QuadraticBezier):
                controls = [segment.start, segment.control, segment.end]
                chunks.append(_bezier_points(np.array([_xy(p) for p in controls]), tolerance))
            elif isinstance(segment, svgelements.CubicBezier):
                controls = [segment.start, segment.control1, segment.control2, segment.end]
                chunks.append(_bezier_points(np.array([_xy(p) for p in controls]), tolerance))
            elif isinstance(segment, svgelements.Arc):
                for curve in segment.as_cubic_curves():
                    controls = [curve.start, curve.control1, curve.control2, curve.end]
                    chunks.append(_bezier_points(np.array([_xy(p) for p in controls]), tolerance))
        if not chunks:
            continue
        ring = np.concatenate(chunks)
        if len(ring) > 1 and np.allclose(ring[0], ring[-1]):
            ring = ring[:-1]
        if len(ring) >= 3:
            rings.append(ring)
    return rings


def to_polygon(rings: list[NDArray[np.float64]]) -> BaseGeometry:
    """Combine rings with even-odd semantics (holes are rings inside other rings)."""
    geometry: BaseGeometry = Polygon()
    for ring in rings:
        polygon = make_valid(Polygon(ring))
        geometry = geometry.symmetric_difference(polygon)
    return geometry


def polygons(geometry: BaseGeometry) -> list[Polygon]:
    """All non-empty polygons of a geometry (flattening multi-part results)."""
    if isinstance(geometry, Polygon):
        return [] if geometry.is_empty else [geometry]
    if isinstance(geometry, MultiPolygon):
        return [p for p in geometry.geoms if not p.is_empty]
    return [p for g in getattr(geometry, "geoms", []) for p in polygons(g)]


# Drops near-collinear points left by flattening (straight edges traced as curves);
# in document px, i.e. far below print/cut resolution.
SIMPLIFY_TOLERANCE = 0.05


def layer_geometries(document: VectorDocument) -> list[BaseGeometry]:
    """United, simplified geometry of every layer (bottom to top), in document px.

    Adjacent shapes of one color merge, so exports have no internal walls or double cuts.
    """
    return [
        unary_union([to_polygon(flatten(shape.d)) for shape in layer.shapes]).simplify(
            SIMPLIFY_TOLERANCE
        )
        for layer in document.layers
    ]


def to_millimetres(
    geometry: BaseGeometry, document: VectorDocument, width_mm: float
) -> BaseGeometry:
    """Scale to `width_mm` and flip the y axis (SVG y points down, CAD/print y points up)."""
    scale = width_mm / document.width
    flipped = affinity.scale(geometry, xfact=1, yfact=-1, origin=(0, document.height / 2))
    return affinity.scale(flipped, xfact=scale, yfact=scale, origin=(0, 0))
