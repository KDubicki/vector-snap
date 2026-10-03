"""Sanitize and normalize raw tracer output to the VectorSnap SVG contract.

The output document is rebuilt from scratch: only path geometry is read from the tracer
output and colors come from the palette, so nothing else (scripts, entities, external
references) can leak through. See docs/05-api-specification.md#svg-output-contract and
docs/06-image-processing-pipeline.md, section 6.
"""

import re
from dataclasses import dataclass

import numpy as np
from lxml import etree
from numpy.typing import NDArray

from app import __version__
from app.services.vectorization import TracedLayer

SVG_NS = "http://www.w3.org/2000/svg"
ALLOWED_ELEMENTS = frozenset({"svg", "g", "path", "title", "desc"})

_NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")
_TRANSLATE_RE = re.compile(r"translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)")


@dataclass(frozen=True)
class SvgDocument:
    svg: str
    path_count: int


def translate_path(d: str, dx: float, dy: float, precision: int) -> str:
    """Bake a translation into a path made of absolute (x, y) pairs (vtracer output).

    vtracer only emits absolute M/L/C/Z commands, so numbers alternate between x and y.
    """
    position = 0

    def shift(match: re.Match[str]) -> str:
        nonlocal position
        value = float(match.group()) + (dx if position % 2 == 0 else dy)
        position += 1
        text = f"{value:.{precision}f}".rstrip("0").rstrip(".") if precision else f"{value:.0f}"
        return "0" if text == "-0" else text

    return _NUMBER_RE.sub(shift, d).strip()


def extract_paths(raw_svg: str, precision: int) -> list[str]:
    """Read path data from vtracer output, baking `translate()` transforms into coordinates."""
    parser = etree.XMLParser(
        resolve_entities=False, no_network=True, remove_comments=True, huge_tree=False
    )
    source = etree.fromstring(raw_svg.encode(), parser=parser)
    paths: list[str] = []
    for element in source.iter(f"{{{SVG_NS}}}path"):
        d = element.get("d", "")
        if not d:
            continue
        match = _TRANSLATE_RE.search(element.get("transform", ""))
        dx, dy = (float(match.group(1)), float(match.group(2))) if match else (0.0, 0.0)
        paths.append(translate_path(d, dx, dy, precision))
    return paths


def build_svg(
    layers: list[TracedLayer],
    palette: NDArray[np.uint8],
    width: int,
    height: int,
    *,
    precision: int,
) -> SvgDocument:
    """Assemble traced layers into the VectorSnap SVG contract.

    One `<g data-palette-index fill>` per color layer, bottom to top; every path gets a
    stable `id` (`p-{paletteIndex}-{sequence}`) and `data-palette-index`.
    """
    svg = etree.Element(
        f"{{{SVG_NS}}}svg",
        nsmap={None: SVG_NS},
        attrib={
            "viewBox": f"0 0 {width} {height}",
            "width": str(width),
            "height": str(height),
            "data-generator": f"vectorsnap/{__version__}",
        },
    )
    path_count = 0
    for layer in layers:
        index = layer.palette_index
        color = palette[index]
        group = etree.SubElement(
            svg,
            f"{{{SVG_NS}}}g",
            attrib={
                "id": f"color-{index}",
                "data-palette-index": str(index),
                "fill": "#{:02x}{:02x}{:02x}".format(*(int(v) for v in color)),
            },
        )
        for sequence, d in enumerate(extract_paths(layer.raw_svg, precision)):
            etree.SubElement(
                group,
                f"{{{SVG_NS}}}path",
                attrib={"id": f"p-{index}-{sequence}", "data-palette-index": str(index), "d": d},
            )
            path_count += 1

    return SvgDocument(svg=etree.tostring(svg, encoding="unicode"), path_count=path_count)
