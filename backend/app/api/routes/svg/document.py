"""Change the document as a whole: crop it to its shapes."""

from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.concurrency import run_in_threadpool

from app.api.export_forms import UploadedSvg
from app.schemas.palette import parse_palette_indices
from app.schemas.svg import SvgCropResponse
from app.services.svg_crop import crop_document
from app.services.svg_edit import serialize_svg

router = APIRouter()


@router.post("/crop", response_model=SvgCropResponse)
async def crop_svg(
    document: UploadedSvg,
    padding: Annotated[
        float, Form(ge=0, le=10_000, description="Margin kept around the shapes, px")
    ] = 0.0,
    ignore_colors: Annotated[
        str,
        Form(
            description="JSON array of palette indices whose shapes do not count, e.g. a "
            "background filling everything"
        ),
    ] = "[]",
) -> SvgCropResponse:
    """Trim the empty margin: the viewBox becomes the box around the shapes plus
    `padding`, and the shapes move with it, curves kept."""
    ignore = parse_palette_indices(ignore_colors, "ignore_colors")
    cropped = await run_in_threadpool(crop_document, document, padding, ignore)
    return SvgCropResponse(
        svg=serialize_svg(cropped.document),
        width=cropped.document.width,
        height=cropped.document.height,
        dx=cropped.dx,
        dy=cropped.dy,
    )
