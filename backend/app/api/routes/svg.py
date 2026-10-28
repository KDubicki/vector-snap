"""Edit SVG documents (VectorSnap contract) on the server. See docs/05-api-specification.md#svg."""

from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.concurrency import run_in_threadpool

from app.api.export_forms import UploadedSvg
from app.core.errors import InvalidParameters
from app.schemas.palette import parse_hex_colors, rgb_to_hex
from app.schemas.svg import (
    ColorChangeModel,
    SvgEditResponse,
    SvgSplitResponse,
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
from app.services.svg_split import split_along_line

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
