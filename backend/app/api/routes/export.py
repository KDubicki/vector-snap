"""Export SVG documents (VectorSnap contract) to other formats. See docs/13-export-formats.md."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.deps import read_upload
from app.core.config import Settings, get_settings
from app.schemas.export import (
    FilamentConflictModel,
    FilamentPlanResponse,
    FilamentStepModel,
    parse_layer_heights,
)
from app.services.export_3mf import export_3mf
from app.services.export_dxf import DxfOptions, export_dxf
from app.services.export_pdf import PageSize, PdfOptions, export_pdf
from app.services.export_stl import StlOptions, export_stl
from app.services.filament_plan import filament_plan
from app.services.svg_geometry import VectorDocument, parse_svg

router = APIRouter(prefix="/export", tags=["export"])


async def uploaded_svg(
    settings: Annotated[Settings, Depends(get_settings)],
    svg: Annotated[UploadFile, File(description="SVG in the VectorSnap contract")],
) -> VectorDocument:
    """Read and parse the `svg` form field every export takes."""
    return parse_svg(await read_upload(svg, settings))


UploadedSvg = Annotated[VectorDocument, Depends(uploaded_svg)]


def _attachment(content: bytes, media_type: str, extension: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="vectorsnap.{extension}"'},
    )


def stl_options(
    width_mm: Annotated[float, Form(gt=0, le=10_000, description="Model width")] = 100.0,
    base_mm: Annotated[float, Form(ge=0, le=100, description="Base plate thickness")] = 1.0,
    layer_mm: Annotated[float, Form(gt=0, le=100, description="Height per color layer")] = 1.0,
    layered: Annotated[bool, Form(description="Stack color layers at increasing heights")] = True,
    layer_heights: Annotated[
        str, Form(description='Per-color height, e.g. {"0": 0, "2": 3.5}; 0 omits a color')
    ] = "{}",
    mirror: Annotated[bool, Form(description="Mirror horizontally (stamps)")] = False,
    min_feature_mm: Annotated[
        float, Form(ge=0, le=10, description="Remove parts narrower than this (nozzle width)")
    ] = 0.0,
    print_layer_mm: Annotated[
        float, Form(ge=0, le=1, description="Printer layer height; heights snap to it")
    ] = 0.0,
) -> StlOptions:
    """3D model options shared by STL and 3MF."""
    return StlOptions(
        width_mm=width_mm,
        base_mm=base_mm,
        layer_mm=layer_mm,
        layered=layered,
        layer_heights=parse_layer_heights(layer_heights),
        mirror=mirror,
        min_feature_mm=min_feature_mm,
        print_layer_mm=print_layer_mm,
    )


ModelOptions = Annotated[StlOptions, Depends(stl_options)]


@router.post(
    "/stl",
    response_class=Response,
    responses={200: {"content": {"model/stl": {}}, "description": "Binary STL"}},
)
async def export_to_stl(document: UploadedSvg, options: ModelOptions) -> Response:
    """Extrude every color layer into a 3D model for printing (units: millimetres)."""
    content = await run_in_threadpool(export_stl, document, options)
    return _attachment(content, "model/stl", "stl")


@router.post(
    "/3mf",
    response_class=Response,
    responses={200: {"content": {"model/3mf": {}}, "description": "3MF package"}},
)
async def export_to_3mf(document: UploadedSvg, options: ModelOptions) -> Response:
    """Like STL, but one colored part per color in one model — for multi-color printers."""
    content = await run_in_threadpool(export_3mf, document, options)
    return _attachment(content, "model/3mf", "3mf")


@router.post("/filament-plan", response_model=FilamentPlanResponse)
async def export_filament_plan(
    document: UploadedSvg, options: ModelOptions
) -> FilamentPlanResponse:
    """Where to change filament when printing the STL/3MF on a single-extruder printer."""
    plan = await run_in_threadpool(filament_plan, document, options)
    return FilamentPlanResponse(
        steps=[FilamentStepModel(z_mm=s.z_mm, layer=s.layer, color=s.color) for s in plan.steps],
        conflicts=[FilamentConflictModel(z_mm=c.z_mm, colors=c.colors) for c in plan.conflicts],
        height_mm=plan.height_mm,
    )


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
    return _attachment(content, "image/vnd.dxf", "dxf")


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
    return _attachment(content, "application/pdf", "pdf")
