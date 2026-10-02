from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.api.deps import read_upload
from app.core.config import Settings, get_settings
from app.core.errors import NotImplementedYet
from app.schemas.quantize import QuantizeAlgorithm, QuantizeResponse

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
    await read_upload(image, settings)
    # TODO: decode -> quantize -> encode indexed PNG (docs/06-image-processing-pipeline.md)
    raise NotImplementedYet("Quantization is not implemented yet.")
