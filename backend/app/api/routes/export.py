"""Export SVG documents (VectorSnap contract) to other formats. See docs/13-export-formats.md."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.deps import read_upload
from app.core.config import Settings, get_settings
from app.services.export_dxf import DxfOptions, export_dxf
from app.services.export_pdf import PageSize, PdfOptions, export_pdf
from app.services.export_stl import StlOptions, export_stl
from app.services.svg_geometry import parse_svg

router = APIRouter(prefix="/export", tags=["export"])

SvgFile = Annotated[UploadFile, File(description="SVG in the VectorSnap contract")]


def _attachment(content: bytes, media_type: str, extension: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="vectorsnap.{extension}"'},
    )


@router.post(
    "/stl",
    response_class=Response,
    responses={200: {"content": {"model/stl": {}}, "description": "Binary STL"}},
)
async def export_to_stl(
    settings: Annotated[Settings, Depends(get_settings)],
    svg: SvgFile,
    width_mm: Annotated[float, Form(gt=0, le=10_000, description="Model width")] = 100.0,
    base_mm: Annotated[float, Form(ge=0, le=100, description="Base plate thickness")] = 1.0,
    layer_mm: Annotated[float, Form(gt=0, le=100, description="Height per color layer")] = 1.0,
    layered: Annotated[bool, Form(description="Stack color layers at increasing heights")] = True,
) -> Response:
    """Extrude every color layer into a 3D model for printing (units: millimetres)."""
    document = parse_svg(await read_upload(svg, settings))
    options = StlOptions(width_mm=width_mm, base_mm=base_mm, layer_mm=layer_mm, layered=layered)
    content = await run_in_threadpool(export_stl, document, options)
    return _attachment(content, "model/stl", "stl")


@router.post(
    "/dxf",
    response_class=Response,
    responses={200: {"content": {"image/vnd.dxf": {}}, "description": "DXF R2010"}},
)
async def export_to_dxf(
    settings: Annotated[Settings, Depends(get_settings)],
    svg: SvgFile,
    width_mm: Annotated[float, Form(gt=0, le=10_000, description="Drawing width")] = 100.0,
    fill: Annotated[bool, Form(description="Add solid hatch fills")] = False,
) -> Response:
    """Closed outlines per color layer for laser cutters, plotters and CNC (units: mm)."""
    document = parse_svg(await read_upload(svg, settings))
    content = await run_in_threadpool(
        export_dxf, document, DxfOptions(width_mm=width_mm, fill=fill)
    )
    return _attachment(content, "image/vnd.dxf", "dxf")


@router.post(
    "/pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}, "description": "One-page PDF"}},
)
async def export_to_pdf(
    settings: Annotated[Settings, Depends(get_settings)],
    svg: SvgFile,
    page: Annotated[PageSize, Form(description="fit = page fits the drawing")] = "fit",
    width_mm: Annotated[float, Form(gt=0, le=10_000, description="Drawing width (fit)")] = 100.0,
    margin_mm: Annotated[float, Form(ge=0, le=100, description="Page margin")] = 10.0,
) -> Response:
    """Vector PDF with exact curves for print."""
    document = parse_svg(await read_upload(svg, settings))
    options = PdfOptions(page=page, width_mm=width_mm, margin_mm=margin_mm)
    content = await run_in_threadpool(export_pdf, document, options)
    return _attachment(content, "application/pdf", "pdf")
