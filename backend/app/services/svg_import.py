"""Turn an SVG from another tool (Inkscape, Illustrator, Figma, an icon set) into the
VectorSnap contract, so it can be edited, recolored and exported like a traced image.

svgelements reads the document as a browser would draw it: sizes in mm or in, the
viewBox, transforms, `<use>` copies, CSS classes and styles, `currentColor`, rectangles,
circles, ellipses, polygons and paths; `display: none` is left out. Every filled shape is
then cut to the part of it that shows (what later shapes cover is removed), and the
visible parts of each color are united into one color layer, in the order the colors
first appear. Flattened that way, the layers can be stacked in any order without one
color hiding another, as the contract's layers and the 3D print's heights need.

What the contract has no place for is left out and counted: strokes (outlines are not
filled areas), text, embedded images, invisible shapes. A gradient or pattern fill
becomes the average of its stop colors. See docs/05-api-specification.md#post-apiv1svgimport.
"""

import io
import math
import re
from collections import Counter
from dataclasses import dataclass, field

import numpy as np
import svgelements
from lxml import etree
from numpy.typing import NDArray
from shapely import MultiPolygon, Polygon, STRtree, make_valid, unary_union
from shapely.geometry.base import BaseGeometry

from app.core.errors import InvalidSvg, SvgTooComplex
from app.services.svg_geometry import (
    MAX_COORDINATE,
    SVG_NS,
    VectorDocument,
    VectorLayer,
    VectorShape,
    flatten_path,
    path_data,
    polygons,
    to_polygon,
)

# Points along curves are this far apart relative to the document's longer side: 1 px
# in a document of 1000 px, 0.024 in an icon of 24. A circle of radius r then strays
# from its polygon by spacing² / 8r: 0.04 px for r = 3 px, far below a printer's or
# cutter's resolution.
RELATIVE_TOLERANCE = 1 / 1000
_URL_RE = re.compile(r"url\(\s*['\"]?#([^)'\"]+)['\"]?\s*\)")
_STOP_COLOR_RE = re.compile(r"stop-color\s*:\s*([^;]+)")
# Fill of a gradient whose stops cannot be read.
FALLBACK_COLOR = (128, 128, 128)


@dataclass
class ImportedSvg:
    document: VectorDocument
    shapes_read: int  # filled shapes found in the source
    ignored: Counter[str] = field(default_factory=Counter)  # what was left out, by kind


def _safe_bytes(data: bytes) -> tuple[bytes, etree._Element]:
    """The document re-serialized without a DOCTYPE: entities are never resolved and
    nothing is fetched (an entity reference left in makes the second parse fail)."""
    parser = etree.XMLParser(
        resolve_entities=False, no_network=True, remove_comments=True, huge_tree=False
    )
    try:
        root = etree.fromstring(data, parser=parser)
    except etree.XMLSyntaxError as exc:
        raise InvalidSvg("SVG is not well-formed XML.") from exc
    if root.tag != f"{{{SVG_NS}}}svg":
        raise InvalidSvg("Document is not an SVG.")
    return etree.tostring(root), root


def _stop_colors(root: etree._Element) -> dict[str, tuple[int, int, int]]:
    """The average stop color of every gradient (following `href` to the gradient that
    holds the stops), by id."""
    gradients = {
        element.get("id"): element
        for element in root.iter(f"{{{SVG_NS}}}linearGradient", f"{{{SVG_NS}}}radialGradient")
        if element.get("id")
    }

    def stops(element: etree._Element, depth: int = 0) -> list[tuple[int, int, int]]:
        colors = []
        for stop in element.iter(f"{{{SVG_NS}}}stop"):
            match = _STOP_COLOR_RE.search(stop.get("style", ""))
            value = match[1].strip() if match else stop.get("stop-color", "black")
            color = svgelements.Color(value)
            if color.value is not None:
                colors.append((color.red, color.green, color.blue))
        href = element.get("href") or element.get("{http://www.w3.org/1999/xlink}href") or ""
        if not colors and href.startswith("#") and href[1:] in gradients and depth < 8:
            return stops(gradients[href[1:]], depth + 1)
        return colors

    averages = {}
    for name, element in gradients.items():
        colors = stops(element)
        if colors:
            red, green, blue = np.rint(np.mean(np.array(colors), axis=0)).astype(int).tolist()
            averages[name] = (red, green, blue)
    return averages


def _hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def _nonzero(rings: list[NDArray[np.float64]]) -> BaseGeometry:
    """The area a path fills with the nonzero rule (SVG's default): a ring inside another
    drawn the other way round is a hole, one drawn the same way is filled. Rings are
    nested by containment; the region of a ring outside its children has the winding of
    its parent plus its own direction, and is filled unless that is zero."""
    if len(rings) == 1:  # most shapes: a rectangle, a circle, a path without holes
        return make_valid(Polygon(rings[0]))
    shapes = []
    for ring in rings:
        polygon = Polygon(ring)
        if polygon.area == 0:
            continue
        # Signed area: + one way round, - the other (the axis direction does not matter).
        x, y = ring[:, 0], ring[:, 1]
        signed = float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))
        shapes.append((make_valid(polygon), 1 if signed > 0 else -1))
    shapes.sort(key=lambda item: -item[0].area)
    winding: list[int] = []
    children: list[list[int]] = [[] for _ in shapes]
    for index, (polygon, direction) in enumerate(shapes):
        point = polygon.representative_point()
        parent = next(
            (
                candidate
                for candidate in range(index - 1, -1, -1)
                if shapes[candidate][0].contains(point)
            ),
            None,
        )
        winding.append((winding[parent] if parent is not None else 0) + direction)
        if parent is not None:
            children[parent].append(index)
    filled = [
        polygon.difference(unary_union([shapes[child][0] for child in children[index]]))
        if children[index]
        else polygon
        for index, (polygon, _) in enumerate(shapes)
        if winding[index] != 0
    ]
    return unary_union(filled) if filled else Polygon()


def _visible(painted: list[tuple[str, BaseGeometry]]) -> list[BaseGeometry]:
    """Each outline less what outlines of other colors after it (painted over it)
    cover; the same color over it is united with it anyway."""
    outlines = [outline for _, outline in painted]
    tree = STRtree(outlines)
    visible = []
    for index, (color, outline) in enumerate(painted):
        covering = [
            outlines[other]
            for other in map(int, tree.query(outline, predicate="intersects"))
            if other > index and painted[other][0] != color
        ]
        if len(covering) > 1:
            visible.append(outline.difference(unary_union(covering)))
        else:
            visible.append(outline.difference(covering[0]) if covering else outline)
    return visible


def _fill(element: svgelements.Shape, gradients: dict[str, tuple[int, int, int]]) -> str | None:
    """The `#rrggbb` the element is filled with, None when it is not filled."""
    raw = str(element.values.get("fill", "") or "")
    url = _URL_RE.search(raw)
    if url:
        return _hex(gradients.get(url[1], FALLBACK_COLOR))
    fill = element.fill
    if fill is None or fill.value is None or fill.alpha == 0:
        return None
    return _hex((fill.red, fill.green, fill.blue))


def import_svg(data: bytes, max_shapes: int) -> ImportedSvg:
    """Read any SVG into the contract (see the module docstring); more filled shapes than
    `max_shapes`, read or resulting, is `SvgTooComplex`."""
    safe, root = _safe_bytes(data)
    gradients = _stop_colors(root)
    try:
        svg = svgelements.SVG.parse(io.BytesIO(safe), reify=True, ppi=96)
    except (etree.XMLSyntaxError, ValueError, SyntaxError) as exc:  # ParseError: SyntaxError
        raise InvalidSvg(f"SVG cannot be read: {exc}.") from exc
    width, height = float(svg.width or 0), float(svg.height or 0)
    if not (0 < width <= MAX_COORDINATE and 0 < height <= MAX_COORDINATE):
        raise InvalidSvg("SVG must define a positive viewBox or width/height.")
    tolerance = max(width, height) * RELATIVE_TOLERANCE

    ignored: Counter[str] = Counter()
    painted: list[tuple[str, BaseGeometry]] = []  # paint order, bottom first
    for element in svg.elements():
        if isinstance(element, svgelements.Text):
            ignored["text"] += 1
            continue
        if isinstance(element, svgelements.Image):
            ignored["images"] += 1
            continue
        if not isinstance(element, svgelements.Shape):
            continue
        values = element.values
        if values.get("visibility") in ("hidden", "collapse") or any(
            _transparent(values.get(name)) for name in ("opacity", "fill-opacity")
        ):
            ignored["invisible"] += 1
            continue
        color = _fill(element, gradients)
        stroked = element.stroke is not None and element.stroke.value is not None
        if color is None:
            ignored["strokes" if stroked else "unfilled"] += 1
            continue
        if len(painted) >= max_shapes:
            raise SvgTooComplex(
                f"The SVG has more than {max_shapes} filled shapes; at most {max_shapes} "
                "are accepted.",
                {"max_svg_shapes": max_shapes},
            )
        rings = flatten_path(svgelements.Path(element), tolerance)
        evenodd = values.get("fill-rule") == "evenodd"
        outline = to_polygon(rings) if evenodd else _nonzero(rings)
        if outline.is_empty or outline.area <= 0:
            # A line: what shows of it is its stroke.
            ignored["strokes" if stroked else "no_area"] += 1
            continue
        if stroked:
            ignored["strokes"] += 1  # the fill is kept, the outline drawn around it is not
        if _URL_RE.search(str(values.get("fill", "") or "")):
            ignored["gradients"] += 1  # kept, as one color
        painted.append((color, outline))

    if not painted:
        raise InvalidSvg(
            "SVG contains no filled shapes: outlines (strokes), text and images are left out."
        )
    visible = _visible(painted)
    by_color: dict[str, list[BaseGeometry]] = {}
    for (color, _), part in zip(painted, visible, strict=True):
        if not part.is_empty:
            by_color.setdefault(color, []).append(part)

    layers: list[VectorLayer] = []
    min_area = tolerance * tolerance
    for color, parts in by_color.items():
        index = len(layers)
        pieces = [
            piece
            for piece in polygons(unary_union(parts))
            if piece.area > min_area and _finite(piece)
        ]
        shapes = [
            VectorShape(id=f"p-{index}-{sequence}", fill=color, d=path_data(piece))
            for sequence, piece in enumerate(pieces)
        ]
        if shapes:
            layers.append(VectorLayer(palette_index=index, fill=color, shapes=shapes))
    if not layers:
        raise InvalidSvg("SVG contains no visible filled area.")
    total = sum(len(layer.shapes) for layer in layers)
    if total > max_shapes:  # covered shapes can fall apart into several pieces
        raise SvgTooComplex(
            f"The imported SVG would have {total} shapes; at most {max_shapes} are accepted.",
            {"shapes": total, "max_svg_shapes": max_shapes},
        )
    return ImportedSvg(VectorDocument(width, height, layers), len(painted), ignored)


def _transparent(value: object) -> bool:
    try:
        return value is not None and float(str(value).strip().rstrip("%")) == 0
    except ValueError:
        return False


def _finite(polygon: Polygon | MultiPolygon) -> bool:
    return all(math.isfinite(value) for value in polygon.bounds)
