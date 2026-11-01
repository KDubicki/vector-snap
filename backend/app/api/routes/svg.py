"""Edit SVG documents (VectorSnap contract) on the server. See docs/05-api-specification.md#svg."""

from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.concurrency import run_in_threadpool

from app.api.export_forms import UploadedSvg
from app.core.errors import InvalidParameters
from app.schemas.palette import parse_hex_colors, rgb_to_hex
from app.schemas.svg import (
    ColorChangeModel,
    SvgDeleteResponse,
    SvgEditResponse,
    SvgLassoResponse,
    SvgLayerStatsModel,
    SvgMergeResponse,
    SvgSplitResponse,
    SvgStatsResponse,
    parse_color_map,
    parse_line,
    parse_shape_ids,
)
from app.services.svg_edit import (
    EditedSvg,
    merge_similar_colors,
    recolor,
    serialize_svg,
)
from app.services.svg_shapes import delete_shapes, merge_shapes
from app.services.svg_split import cut_region, split_along_line
from app.services.svg_stats import svg_stats

router = APIRouter(prefix="/svg", tags=["svg"])

# A large filament collection, as `filaments` of /quantize.
MAX_FILAMENTS = 128


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


@router.post("/recolor", response_model=SvgEditResponse)
async def recolor_svg(
    document: UploadedSvg,
    colors: Annotated[
        str,
        Form(description='Colors to replace, e.g. {"#fefefe": "#ffffff", "#808080": "#000000"}'),
    ] = "{}",
    filaments: Annotated[
        str,
        Form(
            description='Loaded filaments, e.g. ["#ffffff", "#000000", "#ff0000"]: every color '
            "becomes the closest of them (CIEDE2000)"
        ),
    ] = "[]",
) -> SvgEditResponse:
    """Replace colors of the layers and shapes: by an explicit mapping, or each by the
    closest of the loaded filaments (both: the mapping first). Layers that end up with
    the same color are joined."""
    mapping = parse_color_map(colors, "colors")
    loaded = [rgb_to_hex(color) for color in parse_hex_colors(filaments, "filaments")]
    if not mapping and not loaded:
        raise InvalidParameters(
            "Send `colors` to replace or the loaded `filaments`.", {"field": "colors"}
        )
    if len(loaded) > MAX_FILAMENTS:
        raise InvalidParameters(f"At most {MAX_FILAMENTS} filaments.", {"field": "filaments"})

    return _response(await run_in_threadpool(recolor, document, mapping, loaded))


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
