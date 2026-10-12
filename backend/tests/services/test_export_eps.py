import pytest

from app.services.export_eps import EpsOptions, export_eps
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg

FRAME = "M0,0 L20,0 L20,20 L0,20 Z M5,5 L5,15 L15,15 L15,5 Z"  # 20x20 with a 10x10 hole
CIRCLE = (
    "M30,10 C30,4.5 34.5,0 40,0 C45.5,0 50,4.5 50,10 "
    "C50,15.5 45.5,20 40,20 C34.5,20 30,15.5 30,10 Z"
)
SVG = contract_svg(50, 20, [("#ff0000", [FRAME]), ("#0000ff", [CIRCLE])])
MM = 72 / 25.4


def _eps(options: EpsOptions, svg: bytes = SVG) -> list[str]:
    return export_eps(parse_svg(svg), options).decode("ascii").splitlines()


def _comment(lines: list[str], name: str) -> list[float]:
    line = next(line for line in lines if line.startswith(f"%%{name}: "))
    return [float(v) for v in line.split(": ", 1)[1].split()]


def _body(lines: list[str]) -> list[str]:
    return lines[lines.index("save") + 1 : lines.index("restore")]


def test_is_a_one_page_eps_with_its_bounding_box() -> None:
    lines = _eps(EpsOptions(width_mm=50, margin_mm=5))

    assert lines[0] == "%!PS-Adobe-3.0 EPSF-3.0"
    assert lines[-1] == "%%EOF"
    assert "showpage" in lines
    assert _comment(lines, "HiResBoundingBox") == pytest.approx([0, 0, 60 * MM, 30 * MM], abs=1e-3)
    assert _comment(lines, "BoundingBox") == [0, 0, 171, 86]  # rounded up to whole points
    assert "%%Title: VectorSnap export" in lines


def test_fills_shapes_in_their_colors_with_holes_as_subpaths() -> None:
    body = _body(_eps(EpsOptions(width_mm=50)))

    assert body[0] == "1 0 0 rg"
    frame = body[1 : body.index("f") + 1]
    assert [line.split()[-1] for line in frame] == ["m", "l", "l", "l", "h"] * 2 + ["f"]
    assert body[body.index("f") + 1] == "0 0 1 rg"
    assert body.count("f") == 2  # one fill per shape: the hole stays a subpath (nonzero)


def test_maps_document_px_to_points_with_the_y_axis_flipped() -> None:
    body = _body(_eps(EpsOptions(width_mm=50, margin_mm=10)))
    margin = 10 * MM

    x, y = (float(v) for v in body[1].split()[:2])  # frame's first point: top-left corner
    assert (x, y) == pytest.approx((margin, margin + 20 * MM), abs=1e-3)
    x, y = (float(v) for v in body[2].split()[:2])  # (20, 0)
    assert (x, y) == pytest.approx((margin + 20 * MM, margin + 20 * MM), abs=1e-3)


def test_curves_stay_bezier_curves() -> None:
    body = _body(_eps(EpsOptions()))

    curves = [line for line in body if line.endswith(" c")]
    assert len(curves) == 4
    assert all(len(line.split()) == 7 for line in curves)


def test_quadratic_curves_and_arcs_become_cubic_curves() -> None:
    svg = contract_svg(
        40, 20, [("#00ff00", ["M0,20 Q10,-20 20,20 Z", "M20,10 A10,10 0 0 1 40,10 Z"])]
    )

    body = _body(_eps(EpsOptions(), svg))

    assert body[0] == "0 1 0 rg"  # one color change for both shapes
    assert sum(line.endswith(" c") for line in body) >= 3
    assert not any(line.split()[-1] in {"q", "a"} for line in body)


def test_shapes_without_path_data_are_left_out() -> None:
    svg = contract_svg(20, 20, [("#000000", [FRAME]), ("#ffffff", [""])])

    body = _body(_eps(EpsOptions(), svg))

    assert body.count("f") == 1
    assert "1 1 1 rg" not in body
