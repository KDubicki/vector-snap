"""Edit SVG documents (VectorSnap contract) on the server. See docs/05-api-specification.md#svg."""

from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.concurrency import run_in_threadpool

from app.api.export_forms import UploadedSvg
from app.schemas.svg import ColorChangeModel, SvgEditResponse
from app.services.svg_edit import EditedSvg, merge_similar_colors, serialize_svg

router = APIRouter(prefix="/svg", tags=["svg"])


def _response(edited: EditedSvg) -> SvgEditResponse:
    return SvgEditResponse(
        svg=serialize_svg(edited.document),
        colors=len(edited.document.layers),
        changes=[
            ColorChangeModel(color=change.color, into=change.into, delta_e=change.delta_e)
            for change in edited.changes
        ],
    )


@router.post("/merge-similar", response_model=SvgEditResponse)
async def merge_similar(
    document: UploadedSvg,
    max_delta_e: Annotated[
        float,
        Form(
            gt=0,
            le=10,
            description="Merge colors closer than this CIEDE2000 difference: below 1 they look "
            "the same, below 2 only differ side by side",
        ),
    ] = 2.0,
) -> SvgEditResponse:
    """Join color layers that look the same (#ffffff and #fefefe) into one: the layer
    covering less moves into the one covering more. Fewer layers, fewer filaments."""
    return _response(await run_in_threadpool(merge_similar_colors, document, max_delta_e))
