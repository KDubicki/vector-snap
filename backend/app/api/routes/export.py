"""Export SVG documents (VectorSnap contract) to other formats. See docs/13-export-formats.md."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.deps import read_upload
from app.api.export_forms import ModelOptions, StlFormatField, UploadedSvg
from app.core.config import Settings, get_settings
from app.schemas.export import (
    ColorChangesResponse,
    FilamentConflictModel,
    FilamentPlanResponse,
    FilamentStepModel,
    FilamentUseModel,
    ModelSizeResponse,
    PrintCheckResponse,
    ThinShapeModel,
    parse_flag,
)
from app.services.color_changes import PLA_DENSITY, ChangeCosts, estimate_color_changes
from app.services.export_3mf import Layout, ThreeMfOptions, export_3mf
from app.services.export_dxf import DxfOptions, export_dxf
from app.services.export_eps import EpsOptions, export_eps
from app.services.export_pdf import PageSize, PdfOptions, export_pdf
from app.services.export_stl import export_stl, export_stl_parts, model_size
from app.services.filament_plan import filament_plan
from app.services.image_io import decode_image
from app.services.lithophane import LithophaneOptions, export_lithophane
from app.services.print_check import check_print

router = APIRouter(prefix="/export", tags=["export"])


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
    document: UploadedSvg, options: ModelOptions, stl_format: StlFormatField = "binary"
) -> Response:
    """Extrude every color layer into a 3D model for printing (units: millimetres)."""
    content = await run_in_threadpool(export_stl, document, options, stl_format)
    return _attachment(content, "model/stl", "stl")


@router.post(
    "/stl-parts",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}, "description": "ZIP of STL files"}},
)
async def export_to_stl_parts(
    document: UploadedSvg, options: ModelOptions, stl_format: StlFormatField = "binary"
) -> Response:
    """Like STL, but one file per part (base, rim, each color) — for any multi-part slicer."""
    content = await run_in_threadpool(export_stl_parts, document, options, stl_format)
    return _attachment(content, "application/zip", "zip")


@router.post(
    "/3mf",
    response_class=Response,
    responses={200: {"content": {"model/3mf": {}}, "description": "3MF package"}},
)
async def export_to_3mf(
    document: UploadedSvg,
    options: ModelOptions,
    title: Annotated[str, Form(max_length=200, description="Model name and title")] = "",
    designer: Annotated[str, Form(max_length=200, description="Designer metadata")] = "",
    description: Annotated[str, Form(max_length=2000, description="Description metadata")] = "",
    layout: Annotated[
        Layout, Form(description="assembly: parts of one model; objects: separate models")
    ] = "assembly",
    slicer_config: Annotated[
        str | None,
        Form(
            description="Assign a filament in its color to every part for Orca-based slicers "
            "(Anycubic Slicer Next, OrcaSlicer, Bambu Studio); true or false, default true"
        ),
    ] = None,
    thumbnail: Annotated[
        str | None,
        Form(
            description="Top view of the colored model as the package thumbnail (PNG); "
            "true or false, default true"
        ),
    ] = None,
) -> Response:
    """Like STL, but one colored part per color in one model — for multi-color printers."""
    package = ThreeMfOptions(
        title=title.strip(),
        designer=designer.strip(),
        description=description.strip(),
        layout=layout,
        slicer_config=parse_flag(slicer_config, "slicer_config", default=True),
        thumbnail=parse_flag(thumbnail, "thumbnail", default=True),
    )
    content = await run_in_threadpool(export_3mf, document, options, package)
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


@router.post("/model-size", response_model=ModelSizeResponse)
async def export_model_size(document: UploadedSvg, options: ModelOptions) -> ModelSizeResponse:
    """Size of the STL/3MF model, to check it against a printer's build volume."""
    size = await run_in_threadpool(model_size, document, options)
    return ModelSizeResponse(x_mm=size.x_mm, y_mm=size.y_mm, z_mm=size.z_mm)


@router.post("/print-check", response_model=PrintCheckResponse)
async def export_print_check(
    document: UploadedSvg,
    options: ModelOptions,
    nozzle_mm: Annotated[float, Form(gt=0, le=2, description="Nozzle width")] = 0.4,
) -> PrintCheckResponse:
    """Shapes of the STL/3MF model narrower than the nozzle where they print: the slicer
    skips them, and min_feature_mm drops them from the export."""
    check = await run_in_threadpool(check_print, document, options, nozzle_mm)
    return PrintCheckResponse(
        nozzle_mm=check.nozzle_mm,
        shapes=[
            ThinShapeModel(
                id=shape.shape_id,
                palette_index=shape.palette_index,
                color=shape.color,
                area_mm2=shape.area_mm2,
                thin_mm2=shape.thin_mm2,
                vanishes=shape.vanishes,
            )
            for shape in check.shapes
        ],
        thin_mm2=check.thin_mm2,
    )


@router.post("/color-changes", response_model=ColorChangesResponse)
async def export_color_changes(
    document: UploadedSvg,
    options: ModelOptions,
    change_s: Annotated[
        float, Form(ge=0, le=600, description="Time of one filament change (seconds)")
    ] = 0.0,
    purge_mm3: Annotated[
        float, Form(ge=0, le=5000, description="Filament purged per change (flush + prime tower)")
    ] = 0.0,
    density_g_cm3: Annotated[
        float, Form(gt=0, le=5, description="Filament density for purge_g")
    ] = PLA_DENSITY,
) -> ColorChangesResponse:
    """How many filament changes a multi-color printer (AMS, ACE, MMU) makes for the 3MF,
    what they cost in time and purged filament, and how much of each filament the model
    takes. Needs print_layer_mm."""
    costs = ChangeCosts(change_s=change_s, purge_mm3=purge_mm3, density_g_cm3=density_g_cm3)
    estimate = await run_in_threadpool(estimate_color_changes, document, options, costs)
    return ColorChangesResponse(
        filaments=[
            FilamentUseModel(color=use.color, volume_mm3=use.volume_mm3, grams=use.grams)
            for use in estimate.filaments
        ],
        layers=estimate.layers,
        changes=estimate.changes,
        max_colors_per_layer=estimate.max_colors_per_layer,
        change_time_s=estimate.change_time_s,
        purge_mm3=estimate.purge_mm3,
        purge_g=estimate.purge_g,
    )


@router.post(
    "/lithophane",
    response_class=Response,
    responses={200: {"content": {"model/stl": {}}, "description": "Binary STL"}},
)
async def export_to_lithophane(
    settings: Annotated[Settings, Depends(get_settings)],
    image: Annotated[UploadFile, File(description="JPEG or PNG image (the original upload)")],
    width_mm: Annotated[float, Form(gt=0, le=1000, description="Image width")] = 100.0,
    min_thickness_mm: Annotated[
        float, Form(ge=0.2, le=10, description="Thickness of the brightest areas")
    ] = 0.8,
    max_thickness_mm: Annotated[
        float, Form(gt=0.2, le=20, description="Thickness of the darkest areas and the frame")
    ] = 3.0,
    resolution_mm: Annotated[float, Form(ge=0.05, le=5, description="Grid spacing (detail)")] = 0.2,
    frame_mm: Annotated[
        float, Form(ge=0, le=50, description="Solid border around the image")
    ] = 0.0,
    invert: Annotated[bool, Form(description="Bright areas thick (relief)")] = False,
) -> Response:
    """Thin plate whose thickness follows the image brightness; shows the photo backlit."""
    data = await read_upload(image, settings)
    options = LithophaneOptions(
        width_mm=width_mm,
        min_thickness_mm=min_thickness_mm,
        max_thickness_mm=max_thickness_mm,
        resolution_mm=resolution_mm,
        frame_mm=frame_mm,
        invert=invert,
    )
    decoded = await run_in_threadpool(decode_image, data, settings.max_image_dimension)
    content = await run_in_threadpool(export_lithophane, decoded, options)
    return _attachment(content, "model/stl", "stl")


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
    return _attachment(content, "application/postscript", "eps")
