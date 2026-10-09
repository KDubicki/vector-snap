import base64
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.deps import check_color_count, read_upload
from app.core.config import Settings, get_settings
from app.schemas.palette import palette_colors, parse_hex_colors
from app.schemas.quantize import (
    ColorCountError,
    ColorSuggestionResponse,
    EncodedImage,
    QuantizeAlgorithm,
    QuantizeResponse,
)
from app.services.pipeline import (
    background_index,
    quantize_image,
    suggest_colors,
    to_indexed_png,
)
from app.services.quantization import MAX_SMOOTH, SUGGEST_TARGET_DELTA_E

router = APIRouter(tags=["processing"])


@router.post("/quantize", response_model=QuantizeResponse)
async def quantize(
    settings: Annotated[Settings, Depends(get_settings)],
    image: Annotated[UploadFile, File(description="JPEG or PNG image")],
    colors: Annotated[int, Form(ge=1, description="Target palette size")],
    algorithm: Annotated[QuantizeAlgorithm, Form()] = QuantizeAlgorithm.KMEANS,
    locked_colors: Annotated[str, Form(description="JSON array of hex colors")] = "[]",
    max_working_size: Annotated[int, Form(ge=64)] = 1024,
    seed: Annotated[int, Form()] = 0,
    smooth: Annotated[
        int,
        Form(
            ge=0,
            le=MAX_SMOOTH,
            description="Clean up noisy color regions: 0 = off, 1-3 = majority window size",
        ),
    ] = 0,
    upscale: Annotated[
        bool,
        Form(description="Enlarge images under 1024 px (up to 4x) for smoother outlines"),
    ] = False,
) -> QuantizeResponse:
    data = await read_upload(image, settings)
    check_color_count(colors, settings)
    locked = parse_hex_colors(locked_colors, "locked_colors")

    decoded, result = await run_in_threadpool(
        quantize_image,
        data,
        colors=colors,
        algorithm=algorithm.value,
        max_dimension=settings.max_image_dimension,
        locked_colors=locked,
        max_working_size=max_working_size,
        seed=seed,
        smooth=smooth,
        upscale=upscale,
    )
    png = await run_in_threadpool(to_indexed_png, result)

    return QuantizeResponse(
        width=decoded.width,
        height=decoded.height,
        palette=palette_colors(result.palette, result.coverage),
        has_transparency=result.has_transparency,
        background_index=background_index(result.labels),
        image=EncodedImage(data=base64.b64encode(png).decode("ascii")),
    )


@router.post("/suggest-colors", response_model=ColorSuggestionResponse)
async def suggest_color_count(
    settings: Annotated[Settings, Depends(get_settings)],
    image: Annotated[UploadFile, File(description="JPEG or PNG image")],
) -> ColorSuggestionResponse:
    """Suggest a palette size: the fewest colors whose mean error stays below the target."""
    data = await read_upload(image, settings)
    suggestion = await run_in_threadpool(
        suggest_colors,
        data,
        min_colors=settings.min_colors,
        max_colors=settings.max_colors,
        max_dimension=settings.max_image_dimension,
    )
    return ColorSuggestionResponse(
        colors=suggestion.colors,
        target_delta_e=SUGGEST_TARGET_DELTA_E,
        errors=[
            ColorCountError(colors=k, mean_delta_e=round(error, 2))
            for k, error in suggestion.errors
        ],
    )
