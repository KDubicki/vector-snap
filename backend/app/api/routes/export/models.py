"""3D models to print: STL, STL parts, 3MF, tiles, lithophane and cookie cutter."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.deps import read_upload
from app.api.export_forms import (
    ExcludedColors,
    ModelOptions,
    PackageOptions,
    StlFormatField,
    UploadedSvg,
)
from app.api.responses import attachment
from app.core.config import Settings, get_settings
from app.schemas.export import parse_flag
from app.services.cookie_cutter import CookieCutterOptions, export_cookie_cutter
from app.services.export_3mf import export_3mf
from app.services.export_stl import export_stl, export_stl_parts
from app.services.image_io import decode_image
from app.services.lithophane import LithophaneOptions, export_lithophane
from app.services.tiles import export_tiles

router = APIRouter()


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
    return attachment(content, "model/stl", "stl")


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
    return attachment(content, "application/zip", "zip")


@router.post(
    "/3mf",
    response_class=Response,
    responses={200: {"content": {"model/3mf": {}}, "description": "3MF package"}},
)
async def export_to_3mf(
    document: UploadedSvg, options: ModelOptions, package: PackageOptions
) -> Response:
    """Like STL, but one colored part per color in one model — for multi-color printers."""
    content = await run_in_threadpool(export_3mf, document, options, package)
    return attachment(content, "model/3mf", "3mf")


@router.post(
    "/tiles",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}, "description": "ZIP of 3MF tiles"}},
)
async def export_to_tiles(
    document: UploadedSvg,
    options: ModelOptions,
    package: PackageOptions,
    tile_x_mm: Annotated[
        float, Form(ge=10, le=10_000, description="Largest tile width: the bed's X")
    ] = 220.0,
    tile_y_mm: Annotated[
        float, Form(ge=10, le=10_000, description="Largest tile depth: the bed's Y")
    ] = 220.0,
) -> Response:
    """The 3MF model cut into equal tiles that each fit the bed, one 3MF per tile: for
    signs larger than the printer, printed in parts and joined edge to edge."""
    content = await run_in_threadpool(
        export_tiles, document, options, package, tile_x_mm, tile_y_mm
    )
    return attachment(content, "application/zip", "zip")


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
    return attachment(content, "model/stl", "stl")


@router.post(
    "/cookie-cutter",
    response_class=Response,
    responses={200: {"content": {"model/stl": {}}, "description": "Binary STL"}},
)
async def export_to_cookie_cutter(
    document: UploadedSvg,
    exclude: ExcludedColors,
    width_mm: Annotated[float, Form(gt=0, le=500, description="Cookie width")] = 80.0,
    height_mm: Annotated[float, Form(ge=3, le=60, description="Cutter height")] = 15.0,
    wall_mm: Annotated[float, Form(ge=0.4, le=5, description="Blade thickness")] = 1.2,
    flange_mm: Annotated[
        float, Form(ge=0, le=20, description="Flange width beyond the blade; 0 = none")
    ] = 4.0,
    flange_height_mm: Annotated[float, Form(gt=0, le=20, description="Flange height")] = 2.0,
    smooth_mm: Annotated[
        float, Form(ge=0, le=10, description="Close notches narrower than twice this")
    ] = 1.0,
    mirror: Annotated[
        str | None,
        Form(
            description="Mirror the footprint so the cookie comes out as the design (the "
            "cutter is printed flange down, used flange up); true or false, default true"
        ),
    ] = None,
) -> Response:
    """Cookie cutter following the design's silhouette: a thin blade on the outline and a
    flange at its foot, printed flange down."""
    options = CookieCutterOptions(
        width_mm=width_mm,
        height_mm=height_mm,
        wall_mm=wall_mm,
        flange_mm=flange_mm,
        flange_height_mm=flange_height_mm,
        smooth_mm=smooth_mm,
        mirror=parse_flag(mirror, "mirror", default=True),
        exclude=exclude,
    )
    content = await run_in_threadpool(export_cookie_cutter, document, options)
    return attachment(content, "model/stl", "stl")
