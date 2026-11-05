"""Cut shapes as the editor's knife and lasso: along a line or out of a region."""

from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.concurrency import run_in_threadpool

from app.api.export_forms import UploadedSvg
from app.api.responses import SvgEditRoute
from app.schemas.svg import (
    SvgLassoResponse,
    SvgSplitResponse,
    parse_line,
    parse_shape_ids,
)
from app.services.svg_edit import (
    serialize_svg,
)
from app.services.svg_split import cut_region, split_along_line

router = APIRouter(route_class=SvgEditRoute)


@router.post("/split", response_model=SvgSplitResponse)
async def split_svg(
    document: UploadedSvg,
    line: Annotated[
        str,
        Form(description="Knife line in document px, e.g. [[0, 50], [200, 50]] (2+ points)"),
    ],
    ids: Annotated[
        str,
        Form(
            description='Shapes to split, e.g. ["p-1-0"]: when the line crosses none of them, '
            "every shape it fully crosses"
        ),
    ] = "[]",
) -> SvgSplitResponse:
    """Split the shapes a line fully crosses into pieces, as the editor's knife: a shape
    the line starts or ends on (the background) stays whole."""
    points = parse_line(line, "line")
    selected = parse_shape_ids(ids, "ids")
    edited = await run_in_threadpool(split_along_line, document, points, selected)
    return SvgSplitResponse(
        svg=serialize_svg(edited.document), split=edited.split, created=edited.created
    )


@router.post("/lasso", response_model=SvgLassoResponse)
async def lasso_svg(
    document: UploadedSvg,
    region: Annotated[
        str,
        Form(description="Closed lasso region in document px, e.g. [[0, 0], [50, 0], [0, 50]]"),
    ],
    ids: Annotated[
        str,
        Form(
            description='Shapes to cut, e.g. ["p-1-0"]; without them the topmost shape under '
            "the region's first point"
        ),
    ] = "[]",
) -> SvgLassoResponse:
    """Cut a region out of shapes, as the editor's lasso: each shape it partly covers is
    replaced by its pieces inside and outside the region."""
    points = parse_line(region, "region", min_points=3)
    selected = parse_shape_ids(ids, "ids")
    edited = await run_in_threadpool(cut_region, document, points, selected)
    return SvgLassoResponse(
        svg=serialize_svg(edited.document),
        cut=edited.cut,
        inside=edited.inside,
        outside=edited.outside,
    )
