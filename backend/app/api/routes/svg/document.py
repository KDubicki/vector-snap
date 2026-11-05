"""Change the document as a whole: crop it to its shapes, reorder its color layers."""

from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.concurrency import run_in_threadpool

from app.api.export_forms import UploadedSvg
from app.api.responses import SvgEditRoute
from app.core.errors import InvalidParameters
from app.schemas.palette import parse_palette_indices
from app.schemas.svg import SvgCropResponse, SvgReorderResponse, parse_layer_order
from app.services.svg_crop import crop_document
from app.services.svg_edit import serialize_svg
from app.services.svg_reorder import LayerSort, reorder_layers

router = APIRouter(route_class=SvgEditRoute)


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


@router.post("/reorder", response_model=SvgReorderResponse)
async def reorder_svg(
    document: UploadedSvg,
    order: Annotated[
        str,
        Form(description="JSON array of every palette index, bottom to top, e.g. [2, 0, 1]"),
    ] = "[]",
    sort: Annotated[
        LayerSort | None,
        Form(
            description="Instead of `order`: light_to_dark, dark_to_light, or largest_first "
            "(the layer covering most at the bottom)"
        ),
    ] = None,
) -> SvgReorderResponse:
    """Put the color layers in another order (what covers what, the 3D print's bottom
    color): explicitly or sorted."""
    indices = parse_layer_order(order, "order")
    if bool(indices) == (sort is not None):
        raise InvalidParameters("Send either `order` or `sort`.", {"field": "order"})
    reordered = await run_in_threadpool(reorder_layers, document, indices, sort)
    return SvgReorderResponse(
        svg=serialize_svg(reordered),
        order=[layer.palette_index for layer in reordered.layers],
    )
