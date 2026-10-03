from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.deps import check_color_count, read_upload
from app.core.config import Settings, get_settings
from app.schemas.palette import PaletteColor, parse_hex_colors, rgb_to_hex
from app.schemas.quantize import QuantizeAlgorithm
from app.schemas.vectorize import Stacking, TracingMode, VectorizeResponse, VectorizeStats
from app.services.pipeline import vectorize_image
from app.services.vectorization import TracingOptions

router = APIRouter(tags=["processing"])

SVG_MEDIA_TYPE = "image/svg+xml"


def _wants_svg(request: Request) -> bool:
    accept = request.headers.get("accept", "")
    return SVG_MEDIA_TYPE in accept and "application/json" not in accept


@router.post(
    "/vectorize",
    response_model=VectorizeResponse,
    responses={200: {"content": {SVG_MEDIA_TYPE: {}}}},
)
async def vectorize(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    image: Annotated[UploadFile, File(description="Indexed PNG from /quantize, or JPEG/PNG")],
    palette: Annotated[str | None, Form(description="JSON array of hex colors")] = None,
    colors: Annotated[int | None, Form(ge=1)] = None,
    algorithm: Annotated[QuantizeAlgorithm, Form()] = QuantizeAlgorithm.KMEANS,
    mode: Annotated[TracingMode, Form()] = TracingMode.SPLINE,
    filter_speckle: Annotated[int, Form(ge=0, le=128)] = 4,
    corner_threshold: Annotated[int, Form(ge=0, le=180)] = 60,
    length_threshold: Annotated[float, Form(ge=3.5, le=10)] = 4.0,
    splice_threshold: Annotated[int, Form(ge=0, le=180)] = 45,
    path_precision: Annotated[int, Form(ge=0, le=8)] = 2,
    stacking: Annotated[Stacking, Form()] = Stacking.CUTOUT,
) -> VectorizeResponse | Response:
    data = await read_upload(image, settings)
    if colors is not None:
        check_color_count(colors, settings)
    palette_override = parse_hex_colors(palette, "palette") if palette is not None else None

    result = await run_in_threadpool(
        vectorize_image,
        data,
        max_dimension=settings.max_image_dimension,
        options=TracingOptions(
            mode=mode.value,
            stacking=stacking.value,
            filter_speckle=filter_speckle,
            corner_threshold=corner_threshold,
            length_threshold=length_threshold,
            splice_threshold=splice_threshold,
            path_precision=path_precision,
        ),
        palette_override=palette_override,
        colors=colors,
        algorithm=algorithm.value,
    )

    if _wants_svg(request):
        return Response(content=result.svg, media_type=SVG_MEDIA_TYPE)

    return VectorizeResponse(
        width=result.width,
        height=result.height,
        palette=[
            PaletteColor(
                index=i,
                hex=rgb_to_hex((int(r), int(g), int(b))),
                rgb=(int(r), int(g), int(b)),
                coverage=round(float(result.coverage[i]), 4),
            )
            for i, (r, g, b) in enumerate(result.palette)
        ],
        stats=VectorizeStats(
            paths=result.path_count,
            bytes=len(result.svg.encode()),
            duration_ms=result.duration_ms,
        ),
        svg=result.svg,
    )
