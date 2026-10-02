"""Decoding, validation and encoding of raster images.

See docs/06-image-processing-pipeline.md, sections 1-2.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

SUPPORTED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png"}


@dataclass(frozen=True)
class DecodedImage:
    rgb: NDArray[np.uint8]  # H x W x 3
    alpha_mask: NDArray[np.bool_]  # H x W, True = opaque
    width: int
    height: int
    is_indexed: bool


def decode_image(data: bytes, max_dimension: int) -> DecodedImage:
    """Validate and normalize uploaded bytes into an RGB array and alpha mask."""
    raise NotImplementedError


def encode_indexed_png(
    labels: NDArray[np.uint8], palette: NDArray[np.uint8], transparent_index: int | None
) -> bytes:
    """Encode a label map and palette as a palette-mode PNG."""
    raise NotImplementedError
