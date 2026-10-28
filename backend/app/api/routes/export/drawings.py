"""2D files: DXF, PDF, EPS, PNG, a file per color and the palette."""

from typing import Annotated

from fastapi import APIRouter, Form, Response
from fastapi.concurrency import run_in_threadpool

from app.api.export_forms import UploadedSvg
from app.api.responses import attachment
from app.services.export_dxf import DxfOptions, export_dxf
from app.services.export_eps import EpsOptions, export_eps
from app.services.export_layers import LayerFormat, LayersOptions, export_layers
from app.services.export_palette import MEDIA_TYPES, PaletteFormat, export_palette
from app.services.export_pdf import PageSize, PdfOptions, export_pdf
from app.services.export_png import PngOptions, export_png

router = APIRouter()


@router.post(
    "/dxf",
    response_class=Response,
    responses={200: {"content": {"image/vnd.dxf": {}}, "description": "DXF R2010"}},
)
async def export_to_dxf(
    document: UploadedSvg,
    width_mm: Annotated[float, Form(gt=0, le=10_000, description="Drawing width")] = 100.0,
    fill: Annotated[bool, Form(description="Add solid hatch fills")] = False,
) -> Response:
    """Closed outlines per color layer for laser cutters, plotters and CNC (units: mm)."""
    content = await run_in_threadpool(
        export_dxf, document, DxfOptions(width_mm=width_mm, fill=fill)
    )
    return attachment(content, "image/vnd.dxf", "dxf")


@router.post(
    "/pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}, "description": "One-page PDF"}},
)
async def export_to_pdf(
    document: UploadedSvg,
    page: Annotated[PageSize, Form(description="fit = page fits the drawing")] = "fit",
    width_mm: Annotated[float, Form(gt=0, le=10_000, description="Drawing width (fit)")] = 100.0,
    margin_mm: Annotated[float, Form(ge=0, le=100, description="Page margin")] = 10.0,
) -> Response:
    """Vector PDF with exact curves for print."""
    options = PdfOptions(page=page, width_mm=width_mm, margin_mm=margin_mm)
    content = await run_in_threadpool(export_pdf, document, options)
    return attachment(content, "application/pdf", "pdf")


@router.post(
    "/eps",
    response_class=Response,
    responses={200: {"content": {"application/postscript": {}}, "description": "EPS"}},
)
async def export_to_eps(
    document: UploadedSvg,
    width_mm: Annotated[float, Form(gt=0, le=10_000, description="Drawing width")] = 100.0,
    margin_mm: Annotated[float, Form(ge=0, le=100, description="Margin around the drawing")] = 0.0,
) -> Response:
    """Encapsulated PostScript with exact curves for design and print tools."""
    options = EpsOptions(width_mm=width_mm, margin_mm=margin_mm)
    content = await run_in_threadpool(export_eps, document, options)
    return attachment(content, "application/postscript", "eps")


@router.post(
    "/png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}, "description": "PNG image"}},
)
async def export_to_png(
    document: UploadedSvg,
    width_px: Annotated[int, Form(ge=16, le=4096, description="Image width")] = 1024,
    background: Annotated[
        str,
        Form(
            pattern=r"^(transparent|#[0-9a-fA-F]{6})$",
            description="transparent or a color, #rrggbb",
        ),
    ] = "transparent",
    dpi: Annotated[int, Form(ge=72, le=1200, description="Resolution stored in the file")] = 300,
) -> Response:
    """Raster image with smooth edges, for previews, the web, stickers and print shops."""
    options = PngOptions(
        width_px=width_px,
        background=None if background == "transparent" else background.lower(),
        dpi=dpi,
    )
    content = await run_in_threadpool(export_png, document, options)
    return attachment(content, "image/png", "png")


@router.post(
    "/layers",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}, "description": "ZIP, a file per color"}},
)
async def export_to_layers(
    document: UploadedSvg,
    layer_format: Annotated[LayerFormat, Form(description="File format of every color")] = "svg",
    width_mm: Annotated[
        float, Form(gt=0, le=10_000, description="Drawing width (DXF, PDF)")
    ] = 100.0,
    margin_mm: Annotated[float, Form(ge=0, le=100, description="Page margin (PDF)")] = 0.0,
) -> Response:
    """One file per color on the same canvas, so they line up when stacked: vinyl
    cutters, screen printing, laser cutting one material per color."""
    options = LayersOptions(layer_format=layer_format, width_mm=width_mm, margin_mm=margin_mm)
    content = await run_in_threadpool(export_layers, document, options)
    return attachment(content, "application/zip", "zip")


@router.post(
    "/palette",
    response_class=Response,
    responses={
        200: {
            "content": {media: {} for media in MEDIA_TYPES.values()},
            "description": "Palette file",
        }
    },
)
async def export_to_palette(
    document: UploadedSvg,
    palette_format: Annotated[
        PaletteFormat, Form(description="gpl (GIMP, Inkscape), ase (Adobe), css or json")
    ] = "gpl",
    title: Annotated[
        str, Form(min_length=1, max_length=100, description="Palette name (gpl)")
    ] = "VectorSnap",
) -> Response:
    """The design's colors as a palette file, in order, with the share each one covers."""
    content = await run_in_threadpool(export_palette, document, palette_format, title)
    return attachment(content, MEDIA_TYPES[palette_format], palette_format)
