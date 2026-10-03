import base64
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.deps import check_color_count, read_upload
from app.core.config import Settings, get_settings
from app.schemas.palette import PaletteColor, parse_hex_colors, rgb_to_hex
from app.schemas.quantize import EncodedImage, QuantizeAlgorithm, QuantizeResponse
from app.services.pipeline import quantize_image, to_indexed_png

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
    )
    png = await run_in_threadpool(to_indexed_png, result)

    palette = [
        PaletteColor(
            index=i,
            hex=rgb_to_hex((int(r), int(g), int(b))),
            rgb=(int(r), int(g), int(b)),
            coverage=round(float(result.coverage[i]), 4),
        )
        for i, (r, g, b) in enumerate(result.palette)
    ]
    return QuantizeResponse(
        width=decoded.width,
        height=decoded.height,
        palette=palette,
        has_transparency=result.has_transparency,
        image=EncodedImage(data=base64.b64encode(png).decode("ascii")),
    )
