"""Check an SVG against the VectorSnap contract before editing or exporting it: what the
parser would silently fix, leave out or fail on, for SVGs made or changed by other tools.

Errors make edits and exports fail (not an SVG, no shapes); warnings are repaired or
ignored on the way (a missing id or fill, a duplicate id, shapes outside the viewBox,
elements the contract has no place for). See
docs/05-api-specification.md#post-apiv1svgvalidate.
"""

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Literal

from lxml import etree
from shapely import box

from app.core.errors import InvalidSvg
from app.services.svg_geometry import MAX_COORDINATE, SVG_NS, parse_svg, shape_outline

Severity = Literal["error", "warning"]
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
# More ids than this per problem are counted, not listed.
MAX_LISTED_IDS = 50


@dataclass(frozen=True)
class Problem:
    severity: Severity
    code: str
    message: str
    ids: list[str] = field(default_factory=list)  # shapes concerned, at most MAX_LISTED_IDS


@dataclass(frozen=True)
class Validation:
    colors: int
    shapes: int
    problems: list[Problem]

    @property
    def valid(self) -> bool:
        return not any(problem.severity == "error" for problem in self.problems)


def _warning(code: str, message: str, ids: list[str] | None = None) -> Problem:
    return Problem("warning", code, message, (ids or [])[:MAX_LISTED_IDS])


def validate_svg(data: bytes, max_shapes: int | None = None) -> Validation:
    """Every problem of the SVG, errors first; more shapes than `max_shapes` is an error."""
    try:
        document = parse_svg(data)
    except InvalidSvg as error:
        return Validation(0, 0, [Problem("error", "invalid_svg", error.message)])

    parser = etree.XMLParser(
        resolve_entities=False, no_network=True, remove_comments=True, huge_tree=False
    )
    root = etree.fromstring(data, parser=parser)
    problems: list[Problem] = []

    ignored = Counter(
        etree.QName(child).localname
        for child in root
        if isinstance(child.tag, str) and child.tag != f"{{{SVG_NS}}}g"
    )
    groups = list(root.iterchildren(f"{{{SVG_NS}}}g"))
    for group in groups:
        ignored.update(
            etree.QName(child).localname
            for child in group
            if isinstance(child.tag, str) and child.tag != f"{{{SVG_NS}}}path"
        )
    ignored.pop("defs", None)
    ignored.pop("title", None)
    ignored.pop("desc", None)
    if ignored:
        listed = ", ".join(f"{count} <{name}>" for name, count in sorted(ignored.items()))
        problems.append(
            _warning(
                "ignored_elements", f"Only <g> color groups of <path>s count: {listed} left out."
            )
        )

    no_fill = [group for group in groups if not _HEX_RE.match(group.get("fill") or "")]
    if no_fill:
        problems.append(
            _warning(
                "group_without_fill",
                f"{len(no_fill)} color group(s) without a #rrggbb fill: read as black.",
            )
        )
    no_index = [
        group
        for group in groups
        if not re.fullmatch(r"[+-]?\d+", (group.get("data-palette-index") or "").strip())
    ]
    if no_index:
        problems.append(
            _warning(
                "group_without_index",
                f"{len(no_index)} color group(s) without a whole-number data-palette-index: "
                "numbered by their position.",
            )
        )
    indices = Counter(layer.palette_index for layer in document.layers)
    repeated = sorted(index for index, count in indices.items() if count > 1)
    if repeated:
        problems.append(
            _warning(
                "duplicate_palette_index",
                f"Palette indices used by more than one group: {repeated}; colors are "
                "chosen and printed per index.",
            )
        )

    paths = [path for group in groups for path in group.iterchildren(f"{{{SVG_NS}}}path")]
    without_d = sum(1 for path in paths if not path.get("d"))
    if without_d:
        problems.append(
            _warning("path_without_data", f"{without_d} path(s) without data (d): left out.")
        )
    without_id = sum(1 for path in paths if path.get("d") and not path.get("id"))
    if without_id:
        problems.append(
            _warning("path_without_id", f"{without_id} path(s) without an id: given p-<group>-<n>.")
        )
    ids = Counter(shape.id for layer in document.layers for shape in layer.shapes)
    duplicates = sorted(shape_id for shape_id, count in ids.items() if count > 1)
    if duplicates:
        problems.append(
            _warning(
                "duplicate_id",
                f"{len(duplicates)} id(s) used by more than one shape: edits by id reach "
                "all of them.",
                duplicates,
            )
        )

    page = box(0, 0, document.width, document.height)
    empty: list[str] = []
    outside: list[str] = []
    unreadable: list[str] = []
    for layer in document.layers:
        for shape in layer.shapes:
            try:
                outline = shape_outline(shape)
            except InvalidSvg:
                unreadable.append(shape.id)
                continue
            if outline.is_empty or outline.area <= 0:
                empty.append(shape.id)
            elif not page.covers(outline):
                outside.append(shape.id)
    if empty:
        problems.append(
            _warning(
                "shape_without_area",
                f"{len(empty)} shape(s) without area: nothing to print or cut.",
                empty,
            )
        )
    if outside:
        problems.append(
            _warning(
                "shape_outside_viewbox",
                f"{len(outside)} shape(s) reaching beyond the viewBox: exports keep them, "
                "the SVG view cuts them off.",
                outside,
            )
        )
    if unreadable:
        problems.insert(
            0,
            Problem(
                "error",
                "invalid_path_data",
                f"{len(unreadable)} shape(s) with path data that cannot be read (a command "
                f"short of its numbers, a value that is not a number or beyond "
                f"{MAX_COORDINATE:,.0f} px): edits and exports fail.",
                unreadable[:MAX_LISTED_IDS],
            ),
        )
    shapes = sum(len(layer.shapes) for layer in document.layers)
    if max_shapes is not None and shapes > max_shapes:
        problems.insert(
            0,
            Problem(
                "error",
                "too_many_shapes",
                f"{shapes} shapes; edits and exports accept at most {max_shapes}.",
            ),
        )
    return Validation(len(document.layers), shapes, problems)
