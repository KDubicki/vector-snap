"""Edit shapes as the editor: delete, merge, move/scale/flip/rotate and simplify them."""

from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.concurrency import run_in_threadpool

from app.api.export_forms import UploadedSvg
from app.core.errors import InvalidParameters
from app.schemas.svg import (
    SvgDeleteResponse,
    SvgMergeResponse,
    SvgSimplifyResponse,
    SvgTransformResponse,
    parse_shape_ids,
)
from app.services.svg_edit import (
    serialize_svg,
)
from app.services.svg_shapes import delete_shapes, merge_shapes
from app.services.svg_simplify import simplify_shapes
from app.services.svg_transform import Flip, transform_shapes

router = APIRouter()


@router.post("/delete", response_model=SvgDeleteResponse)
async def delete_svg_shapes(
    document: UploadedSvg,
    ids: Annotated[str, Form(description='Shapes to delete, e.g. ["p-1-0", "p-2-3"]')] = "[]",
    smaller_than: Annotated[
        float,
        Form(
            ge=0,
            le=1_000_000,
            description="Also delete shapes with an area below this, in document px² "
            "(25 = a 5 x 5 px speck); 0 = off",
        ),
    ] = 0.0,
) -> SvgDeleteResponse:
    """Delete shapes by id and/or the specks left by tracing, as the editor's delete:
    layers left empty are removed, and at least one shape has to stay."""
    selected = parse_shape_ids(ids, "ids")
    if not selected and smaller_than == 0:
        raise InvalidParameters(
            "Send the shape `ids` to delete or a `smaller_than` area.", {"field": "ids"}
        )
    edited = await run_in_threadpool(delete_shapes, document, selected, smaller_than)
    return SvgDeleteResponse(
        svg=serialize_svg(edited.document),
        colors=len(edited.document.layers),
        deleted=edited.deleted,
    )


@router.post("/merge", response_model=SvgMergeResponse)
async def merge_svg_shapes(
    document: UploadedSvg,
    ids: Annotated[str, Form(description='Shapes to unite (2+), e.g. ["p-1-0", "p-1-0.b"]')],
) -> SvgMergeResponse:
    """Unite shapes into one, as the editor's merge: it keeps the id, color and place of
    the largest of them."""
    edited = await run_in_threadpool(merge_shapes, document, parse_shape_ids(ids, "ids"))
    return SvgMergeResponse(
        svg=serialize_svg(edited.document),
        colors=len(edited.document.layers),
        id=edited.id,
        merged=edited.merged,
    )


@router.post("/transform", response_model=SvgTransformResponse)
async def transform_svg(
    document: UploadedSvg,
    ids: Annotated[
        str, Form(description='Shapes to transform, e.g. ["p-1-0"]; without them every shape')
    ] = "[]",
    dx: Annotated[float, Form(ge=-1_000_000, le=1_000_000, description="Move right (px)")] = 0.0,
    dy: Annotated[float, Form(ge=-1_000_000, le=1_000_000, description="Move down (px)")] = 0.0,
    scale: Annotated[
        float, Form(gt=0, le=100, description="Size factor around the shapes' center")
    ] = 1.0,
    rotate: Annotated[
        float, Form(ge=-360, le=360, description="Degrees clockwise around the shapes' center")
    ] = 0.0,
    flip: Annotated[
        Flip, Form(description="Mirror around the center: x (left to right) or y (upside down)")
    ] = "none",
) -> SvgTransformResponse:
    """Move, scale, flip and rotate shapes, as the editor's transforms: around the center
    of their bounding box, then moved. Curves stay curves."""
    if dx == dy == rotate == 0 and scale == 1 and flip == "none":
        raise InvalidParameters("Send a move (dx, dy), scale, rotate or flip.", {"field": "scale"})
    selected = parse_shape_ids(ids, "ids")
    edited = await run_in_threadpool(
        lambda: transform_shapes(
            document,
            selected,
            dx=dx,
            dy=dy,
            scale=scale,
            rotate=rotate,
            flip=flip,
        )
    )
    return SvgTransformResponse(svg=serialize_svg(edited.document), transformed=edited.transformed)


@router.post("/simplify", response_model=SvgSimplifyResponse)
async def simplify_svg(
    document: UploadedSvg,
    tolerance: Annotated[
        float,
        Form(gt=0, le=50, description="Largest distance an outline may move, document px"),
    ] = 0.5,
    ids: Annotated[
        str, Form(description='Shapes to simplify, e.g. ["p-1-0"]; without them every shape')
    ] = "[]",
) -> SvgSimplifyResponse:
    """Fewer outline points for cutters, laser software and slicers: Douglas-Peucker within
    `tolerance`, holes kept. Curves become polylines."""
    selected = parse_shape_ids(ids, "ids")
    edited = await run_in_threadpool(simplify_shapes, document, tolerance, selected)
    return SvgSimplifyResponse(
        svg=serialize_svg(edited.document),
        simplified=edited.simplified,
        points_before=edited.points_before,
        points_after=edited.points_after,
    )
