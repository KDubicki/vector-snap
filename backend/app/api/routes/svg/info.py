"""What a document holds: colors, shapes, coverage and specks."""

from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.concurrency import run_in_threadpool

from app.api.export_forms import UploadedSvg
from app.schemas.svg import (
    SvgLayerStatsModel,
    SvgStatsResponse,
)
from app.services.svg_stats import svg_stats

router = APIRouter()


@router.post("/stats", response_model=SvgStatsResponse)
async def svg_statistics(
    document: UploadedSvg,
    speck_area: Annotated[
        float,
        Form(gt=0, le=1_000_000, description="Shapes below this area (document px²) are specks"),
    ] = 25.0,
) -> SvgStatsResponse:
    """Colors, shapes and specks of a document, and how much of the image each color
    covers: to choose filaments or plan a clean-up before editing."""
    stats = await run_in_threadpool(svg_stats, document, speck_area)
    return SvgStatsResponse(
        width=stats.width,
        height=stats.height,
        colors=len(stats.layers),
        shapes=stats.shapes,
        specks=stats.specks,
        layers=[
            SvgLayerStatsModel(
                palette_index=layer.palette_index,
                color=layer.color,
                shapes=layer.shapes,
                own_colors=layer.own_colors,
                area_px2=layer.area_px2,
                share=layer.share,
                specks=layer.specks,
            )
            for layer in stats.layers
        ],
    )
