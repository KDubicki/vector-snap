"""Bring an SVG from another tool into the contract."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.deps import read_upload
from app.api.responses import SvgEditRoute
from app.core.config import Settings, get_settings
from app.schemas.svg import SvgImportResponse
from app.services.svg_edit import serialize_svg
from app.services.svg_import import import_svg

router = APIRouter(route_class=SvgEditRoute)


@router.post("/import", response_model=SvgImportResponse)
async def import_svg_file(
    settings: Annotated[Settings, Depends(get_settings)],
    svg: Annotated[
        UploadFile, File(description="Any SVG: from Inkscape, Illustrator, Figma, an icon set")
    ],
) -> SvgImportResponse:
    """Convert an SVG made by another tool into the VectorSnap contract: one color layer
    per fill color, holding the visible part of every filled shape (sizes, viewBox,
    transforms, styles and copies applied), so it can be edited and exported like a traced
    image. Strokes, text and images are left out and counted in `ignored`."""
    data = await read_upload(svg, settings)
    imported = await run_in_threadpool(import_svg, data, settings.max_svg_shapes)
    document = imported.document
    return SvgImportResponse(
        svg=serialize_svg(document),
        width=document.width,
        height=document.height,
        colors=len(document.layers),
        shapes=sum(len(layer.shapes) for layer in document.layers),
        ignored=dict(sorted(imported.ignored.items())),
    )
