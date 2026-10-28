"""Sheets to cut or color in: print-and-cut sticker, stencil and coloring page."""

from typing import Annotated

from fastapi import APIRouter, Form, Response
from fastapi.concurrency import run_in_threadpool

from app.api.export_forms import ExcludedColors, UploadedSvg
from app.api.responses import attachment
from app.schemas.export import parse_flag
from app.services.coloring_page import ColoringOptions, ColoringPageSize, export_coloring_page
from app.services.stencil import BridgeDirection, StencilFormat, StencilOptions, export_stencil
from app.services.sticker import StickerFormat, StickerOptions, export_sticker

router = APIRouter()


@router.post(
    "/sticker",
    response_class=Response,
    responses={
        200: {
            "content": {"image/svg+xml": {}, "application/pdf": {}},
            "description": "SVG or PDF with a CutContour line",
        }
    },
)
async def export_to_sticker(
    document: UploadedSvg,
    exclude: ExcludedColors,
    sticker_format: Annotated[StickerFormat, Form(description="svg or pdf")] = "svg",
    width_mm: Annotated[float, Form(gt=0, le=1000, description="Design width")] = 70.0,
    border_mm: Annotated[
        float, Form(ge=0, le=50, description="Background beyond the design's outline")
    ] = 3.0,
    background: Annotated[
        str, Form(pattern=r"^#[0-9a-fA-F]{6}$", description="Background color, #rrggbb")
    ] = "#ffffff",
    smooth_mm: Annotated[
        float, Form(ge=0, le=10, description="Close notches narrower than twice this")
    ] = 1.0,
    margin_mm: Annotated[float, Form(ge=0, le=100, description="Page margin (PDF)")] = 5.0,
) -> Response:
    """Print-and-cut sticker: the design on a background around its outline, and a
    `CutContour` line along the background's edge for the plotter."""
    options = StickerOptions(
        sticker_format=sticker_format,
        width_mm=width_mm,
        border_mm=border_mm,
        background=background.lower(),
        smooth_mm=smooth_mm,
        margin_mm=margin_mm,
        exclude=exclude,
    )
    content = await run_in_threadpool(export_sticker, document, options)
    if sticker_format == "pdf":
        return attachment(content, "application/pdf", "pdf")
    return attachment(content, "image/svg+xml", "svg")


@router.post(
    "/stencil",
    response_class=Response,
    responses={
        200: {
            "content": {"image/svg+xml": {}, "image/vnd.dxf": {}, "application/zip": {}},
            "description": "Sheet and cuts; X-Stencil-Bridges: bridges added",
        }
    },
)
async def export_to_stencil(
    document: UploadedSvg,
    exclude: ExcludedColors,
    stencil_format: Annotated[StencilFormat, Form(description="svg or dxf")] = "svg",
    width_mm: Annotated[float, Form(gt=0, le=10_000, description="Design width")] = 100.0,
    margin_mm: Annotated[float, Form(ge=1, le=100, description="Sheet around the cuts")] = 10.0,
    bridge_mm: Annotated[float, Form(ge=0.2, le=20, description="Bridge width")] = 1.5,
    bridges: Annotated[
        BridgeDirection, Form(description="Bridges across islands: horizontal, vertical, both")
    ] = "horizontal",
    per_color: Annotated[
        str | None,
        Form(description="A ZIP of one stencil per color on the same sheet; default false"),
    ] = None,
) -> Response:
    """Stencil sheet with the design cut out; islands, like the middle of an O, are held
    by bridges so they do not fall out."""
    options = StencilOptions(
        stencil_format=stencil_format,
        width_mm=width_mm,
        margin_mm=margin_mm,
        bridge_mm=bridge_mm,
        bridges=bridges,
        per_color=parse_flag(per_color, "per_color", default=False),
        exclude=exclude,
    )
    content, bridges_added = await run_in_threadpool(export_stencil, document, options)
    if options.per_color:
        response = attachment(content, "application/zip", "zip")
    elif stencil_format == "dxf":
        response = attachment(content, "image/vnd.dxf", "dxf")
    else:
        response = attachment(content, "image/svg+xml", "svg")
    response.headers["X-Stencil-Bridges"] = str(bridges_added)
    return response


@router.post(
    "/coloring-page",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}, "description": "One-page PDF"}},
)
async def export_to_coloring_page(
    document: UploadedSvg,
    exclude: ExcludedColors,
    page: Annotated[ColoringPageSize, Form(description="a4 or letter")] = "a4",
    margin_mm: Annotated[float, Form(ge=0, le=50, description="Page margin")] = 12.0,
    line_mm: Annotated[float, Form(ge=0.1, le=3, description="Outline width")] = 0.4,
    numbers: Annotated[
        str | None,
        Form(description="Paint by numbers: numbered regions and a legend; default true"),
    ] = None,
) -> Response:
    """Outlines of every color region on a page, to color in or paint by numbers."""
    options = ColoringOptions(
        page=page,
        margin_mm=margin_mm,
        line_mm=line_mm,
        numbers=parse_flag(numbers, "numbers", default=True),
        exclude=exclude,
    )
    content = await run_in_threadpool(export_coloring_page, document, options)
    return attachment(content, "application/pdf", "pdf")
