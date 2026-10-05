import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
import pytest
from PIL import Image

from app.services.export_pdf import PdfOptions, export_pdf
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg

FRAME = "M0,0 L20,0 L20,20 L0,20 Z M5,5 L5,15 L15,15 L15,5 Z"  # 20x20 with a 10x10 hole
CIRCLE = (
    "M30,10 C30,4.5 34.5,0 40,0 C45.5,0 50,4.5 50,10 "
    "C50,15.5 45.5,20 40,20 C34.5,20 30,15.5 30,10 Z"
)
SVG = contract_svg(50, 20, [("#ff0000", [FRAME]), ("#0000ff", [CIRCLE])])
MM = 72 / 25.4


def _pdf(options: PdfOptions, svg: bytes = SVG) -> pdfium.PdfDocument:
    return pdfium.PdfDocument(export_pdf(parse_svg(svg), options))


def _render(document: pdfium.PdfDocument, scale: float = 1) -> Image.Image:
    image: Image.Image = document[0].render(scale=scale).to_pil().convert("RGB")
    return image


PX_PER_MM = 2


def _at(image: Image.Image, x_mm: float, y_mm: float) -> tuple[int, ...]:
    """Pixel color at a position in mm from the top-left of the page."""
    pixel = image.getpixel((int(x_mm * PX_PER_MM), int(y_mm * PX_PER_MM)))
    assert isinstance(pixel, tuple)
    return pixel


def test_fit_page_matches_drawing_width_plus_margins() -> None:
    page = _pdf(PdfOptions(page="fit", width_mm=50, margin_mm=5))[0]

    width, height = page.get_size()
    assert width == pytest.approx(60 * MM, abs=0.01)
    assert height == pytest.approx(30 * MM, abs=0.01)


def test_fills_shapes_in_their_colors_and_keeps_holes() -> None:
    # 1 document px = 1 mm on the page
    image = _render(_pdf(PdfOptions(page="fit", width_mm=50, margin_mm=0)), PX_PER_MM / MM)

    assert image.size[0] == pytest.approx(50 * PX_PER_MM, abs=1)  # pdfium rounds up
    assert _at(image, 2, 10) == (255, 0, 0)  # frame
    assert _at(image, 10, 10) == (255, 255, 255)  # hole stays empty
    assert _at(image, 40, 10) == (0, 0, 255)  # circle center
    assert _at(image, 31, 1) == (255, 255, 255)  # outside the circle's corner


def test_standard_page_is_landscape_for_wide_drawings_and_centered() -> None:
    document = _pdf(PdfOptions(page="a4", margin_mm=10))
    width, height = document[0].get_size()
    assert (width, height) == pytest.approx((841.89, 595.28), abs=0.01)

    image = _render(document, scale=1)
    # drawing (50x20) scaled into 277x190 mm -> width-limited, vertically centered
    drawing_height = 20 * (277 / 50) * MM
    top = (height - drawing_height) / 2
    assert image.getpixel((int(width / 2), int(top - 5))) == (255, 255, 255)  # above drawing
    assert image.getpixel((int(10 * MM + 5), int(height / 2))) == (255, 0, 0)  # frame


def test_portrait_page_for_tall_drawings() -> None:
    tall = contract_svg(20, 50, [("#000000", [FRAME])])

    width, height = _pdf(PdfOptions(page="letter"), tall)[0].get_size()

    assert (width, height) == pytest.approx((612, 792))


def test_curves_stay_bezier_curves() -> None:
    page = _pdf(PdfOptions())[0]
    segment_types: set[int] = set()
    for obj in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_PATH]):
        for index in range(pdfium_c.FPDFPath_CountSegments(obj.raw)):
            segment = pdfium_c.FPDFPath_GetPathSegment(obj.raw, index)
            segment_types.add(pdfium_c.FPDFPathSegment_GetType(segment))

    assert pdfium_c.FPDF_SEGMENT_BEZIERTO in segment_types
    assert pdfium_c.FPDF_SEGMENT_LINETO in segment_types


def test_quadratic_curves_and_arcs_are_drawn() -> None:
    svg = contract_svg(
        40, 20, [("#00ff00", ["M0,20 Q10,-20 20,20 Z", "M20,10 A10,10 0 0 1 40,10 Z"])]
    )

    image = _render(_pdf(PdfOptions(page="fit", width_mm=40, margin_mm=0), svg), PX_PER_MM / MM)

    assert _at(image, 10, 12) == (0, 255, 0)  # inside the quadratic hump
    assert _at(image, 30, 6) == (0, 255, 0)  # inside the half disc
    assert _at(image, 21, 1) == (255, 255, 255)


def test_metadata() -> None:
    document = _pdf(PdfOptions())

    assert document.get_metadata_dict()["Title"] == "VectorSnap export"
