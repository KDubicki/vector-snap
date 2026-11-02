"""What a document holds: colors, shapes, coverage and specks, and whether it follows the
contract."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.deps import read_upload
from app.api.export_forms import UploadedSvg
from app.core.config import Settings, get_settings
from app.schemas.svg import (
    SvgLayerStatsModel,
    SvgProblemModel,
    SvgStatsResponse,
    SvgValidateResponse,
)
from app.services.svg_stats import svg_stats
from app.services.svg_validate import validate_svg

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


@router.post("/validate", response_model=SvgValidateResponse)
async def validate_svg_file(
    settings: Annotated[Settings, Depends(get_settings)],
    svg: Annotated[UploadFile, File(description="SVG to check against the VectorSnap contract")],
) -> SvgValidateResponse:
    """Check an SVG made or changed by another tool: what edits and exports would fail on
    (errors) or silently repair and leave out (warnings). Never rejects the SVG itself."""
    result = await run_in_threadpool(validate_svg, await read_upload(svg, settings))
    return SvgValidateResponse(
        valid=result.valid,
        colors=result.colors,
        shapes=result.shapes,
        problems=[
            SvgProblemModel(
                severity=problem.severity,
                code=problem.code,
                message=problem.message,
                ids=problem.ids,
            )
            for problem in result.problems
        ],
    )
