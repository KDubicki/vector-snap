"""Export a vector document as Encapsulated PostScript for design and print tools.

Every shape becomes a native PostScript path (cubic Béziers stay curves; quadratic curves
and arcs are converted to cubic) filled with the nonzero rule like SVG. The bounding box
is the drawing at `width_mm` plus a margin. See docs/13-export-formats.md#eps.
"""

import math
from dataclasses import dataclass

from app import __version__
from app.services.svg_geometry import Point, VectorDocument, curve_path

POINTS_PER_MM = 72 / 25.4

# Short procedure names keep large documents small (like PDF's operators).
_PROLOG = (
    "/m {moveto} bind def /l {lineto} bind def /c {curveto} bind def",
    "/h {closepath} bind def /f {fill} bind def /rg {setrgbcolor} bind def",
)


@dataclass(frozen=True)
class EpsOptions:
    width_mm: float = 100.0
    margin_mm: float = 0.0


def _number(value: float) -> str:
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def _rgb(fill: str) -> str:
    return " ".join(_number(int(fill[i : i + 2], 16) / 255) for i in (1, 3, 5))


def export_eps(document: VectorDocument, options: EpsOptions) -> bytes:
    """Return an EPS file with every shape filled in its color."""
    scale = options.width_mm * POINTS_PER_MM / document.width
    margin = options.margin_mm * POINTS_PER_MM
    width = document.width * scale + 2 * margin
    height = document.height * scale + 2 * margin

    def point(p: Point) -> str:
        x = margin + p[0] * scale
        y = margin + (document.height - p[1]) * scale
        return f"{_number(x)} {_number(y)}"

    lines = [
        "%!PS-Adobe-3.0 EPSF-3.0",
        f"%%BoundingBox: 0 0 {math.ceil(width)} {math.ceil(height)}",
        f"%%HiResBoundingBox: 0 0 {_number(width)} {_number(height)}",
        "%%Title: VectorSnap export",
        f"%%Creator: VectorSnap {__version__}",
        "%%LanguageLevel: 2",
        "%%Pages: 1",
        "%%EndComments",
        "%%BeginProlog",
        *_PROLOG,
        "%%EndProlog",
        "%%Page: 1 1",
        "save",
    ]
    color = None
    for layer in document.layers:
        for shape in layer.shapes:
            path = []
            for command, points in curve_path(shape.d):
                if command == "Z":
                    path.append("h")
                else:
                    operator = {"M": "m", "L": "l", "C": "c"}[command]
                    path.append(" ".join(point(p) for p in points) + f" {operator}")
            if not path:
                continue
            if shape.fill != color:
                color = shape.fill
                lines.append(f"{_rgb(color)} rg")
            lines.extend(path)
            lines.append("f")
    lines += ["restore", "showpage", "%%EOF", ""]
    return "\n".join(lines).encode("ascii")
