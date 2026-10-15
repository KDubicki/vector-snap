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
    parse_color_stacks,
    parse_filaments,
    parse_layer_heights,
    parse_shape_heights,
)
from app.services.base_plate import BaseShape
from app.services.export_3mf import export_3mf
from app.services.export_dxf import DxfOptions, export_dxf
from app.services.export_eps import EpsOptions, export_eps
from app.services.export_pdf import PageSize, PdfOptions, export_pdf
from app.services.export_stl import (
    Origin,
    Relief,
    StackOrder,
    StlOptions,
    export_stl,
    export_stl_parts,
)
from app.services.filament_plan import filament_plan
from app.services.image_io import decode_image
from app.services.lithophane import LithophaneOptions, export_lithophane
from app.services.mesh import StlFormat
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
    shape_heights: Annotated[
        str,
        Form(description='Per-shape height, e.g. {"p-2-0": 3}; overrides its color, 0 omits'),
    ] = "{}",
    mirror: Annotated[bool, Form(description="Mirror horizontally (stamps)")] = False,
    min_feature_mm: Annotated[
        float, Form(ge=0, le=10, description="Remove parts narrower than this (nozzle width)")
    ] = 0.0,
    simplify_mm: Annotated[
        float, Form(ge=0, le=2, description="Simplify outlines to this tolerance; 0 = exact")
    ] = 0.0,
    color_gap_mm: Annotated[
        float, Form(ge=0, le=2, description="Gap between neighbouring colors; 0 = none")
    ] = 0.0,
    print_layer_mm: Annotated[
        float, Form(ge=0, le=1, description="Printer layer height; heights snap to it")
    ] = 0.0,
    base_shape: Annotated[
        BaseShape, Form(description="Base plate: design outline, rectangle, rounded or circle")
    ] = "outline",
    base_margin_mm: Annotated[
        float, Form(ge=0, le=100, description="How far the base plate extends beyond the design")
    ] = 0.0,
    stack_order: Annotated[
        StackOrder, Form(description="Bottom-to-top color order: document or by brightness")
    ] = "document",
    relief: Annotated[
        Relief, Form(description="Colors raised on the base plate, or inlaid flush into it")
    ] = "raised",
    origin: Annotated[
        Origin, Form(description="corner: x and y from 0; center: footprint centered on 0")
    ] = "corner",
    rim_mm: Annotated[
        float, Form(ge=0, le=50, description="Raised rim along the base plate's edge; 0 = none")
    ] = 0.0,
    rim_height_mm: Annotated[
        float, Form(ge=0, le=100, description="Rim height above the base; 0 = tallest color")
    ] = 0.0,
    loop_hole_mm: Annotated[
        float, Form(ge=0, le=20, description="Hanging loop hole diameter on the base; 0 = none")
    ] = 0.0,
    magnet_mm: Annotated[
        float, Form(ge=0, le=50, description="Magnet pocket diameter under the base; 0 = none")
    ] = 0.0,
    magnet_depth_mm: Annotated[
        float, Form(gt=0, le=20, description="Magnet pocket depth (below base_mm - 0.4)")
    ] = 2.0,
    elephant_foot_mm: Annotated[
        float, Form(ge=0, le=0.5, description="Inset the base plate's first layer; 0 = off")
    ] = 0.0,
    filaments: Annotated[
        str,
        Form(description='Mixed colors: loaded filaments, e.g. ["#ffffff", "#ff0000"]'),
    ] = "[]",
    color_stacks: Annotated[
        str,
        Form(
            description="Mixed colors: per color its filaments from the top down, e.g. "
            '{"0": {"base": 0, "top": [[1, 0.16]]}}'
        ),
    ] = "{}",
) -> StlOptions:
    """3D model options shared by STL and 3MF."""
    return StlOptions(
        width_mm=width_mm,
        base_mm=base_mm,
        layer_mm=layer_mm,
        layered=layered,
        layer_heights=parse_layer_heights(layer_heights),
        shape_heights=parse_shape_heights(shape_heights),
        mirror=mirror,
        min_feature_mm=min_feature_mm,
        simplify_mm=simplify_mm,
        color_gap_mm=color_gap_mm,
        print_layer_mm=print_layer_mm,
        base_shape=base_shape,
        base_margin_mm=base_margin_mm,
        stack_order=stack_order,
        relief=relief,
        origin=origin,
        rim_mm=rim_mm,
        rim_height_mm=rim_height_mm,
        loop_hole_mm=loop_hole_mm,
        magnet_mm=magnet_mm,
        magnet_depth_mm=magnet_depth_mm,
        elephant_foot_mm=elephant_foot_mm,
        filaments=parse_filaments(filaments),
        color_stacks=parse_color_stacks(color_stacks),
    )


ModelOptions = Annotated[StlOptions, Depends(stl_options)]
StlFormatField = Annotated[
    StlFormat, Form(description="binary (compact) or ascii (text, for tools that need it)")
]


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
