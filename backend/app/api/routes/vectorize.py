from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.api.deps import read_upload
from app.core.config import Settings, get_settings
from app.core.errors import NotImplementedYet
from app.schemas.quantize import QuantizeAlgorithm
from app.schemas.vectorize import Stacking, TracingMode, VectorizeResponse

router = APIRouter(tags=["processing"])


@router.post("/vectorize", response_model=VectorizeResponse)
async def vectorize(
    settings: Annotated[Settings, Depends(get_settings)],
    image: Annotated[UploadFile, File(description="Indexed PNG from /quantize, or JPEG/PNG")],
    palette: Annotated[str | None, Form(description="JSON array of hex colors")] = None,
    colors: Annotated[int | None, Form(ge=1)] = None,
    algorithm: Annotated[QuantizeAlgorithm, Form()] = QuantizeAlgorithm.KMEANS,
    mode: Annotated[TracingMode, Form()] = TracingMode.SPLINE,
    filter_speckle: Annotated[int, Form(ge=0)] = 4,
    corner_threshold: Annotated[int, Form(ge=0, le=180)] = 60,
    length_threshold: Annotated[float, Form(ge=0)] = 4.0,
    splice_threshold: Annotated[int, Form(ge=0, le=180)] = 45,
    path_precision: Annotated[int, Form(ge=0, le=8)] = 2,
    stacking: Annotated[Stacking, Form()] = Stacking.STACKED,
) -> VectorizeResponse:
    await read_upload(image, settings)
    # TODO: indexed / one-shot mode, tracing, post-processing, content negotiation
    # (docs/05-api-specification.md#post-apiv1vectorize)
    raise NotImplementedYet("Vectorization is not implemented yet.")
