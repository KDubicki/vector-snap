"""Color quantization: reduce an image to N representative colors.

See docs/06-image-processing-pipeline.md, section 3.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from app.services.image_io import DecodedImage

TRANSPARENT_LABEL = 255


@dataclass(frozen=True)
class QuantizationResult:
    labels: NDArray[np.uint8]  # H x W palette indices, TRANSPARENT_LABEL for transparent pixels
    palette: NDArray[np.uint8]  # N x 3, sorted by coverage descending
    coverage: NDArray[np.float64]  # N, fraction of opaque pixels


def quantize_kmeans(
    image: DecodedImage,
    colors: int,
    *,
    locked_colors: list[tuple[int, int, int]] | None = None,
    max_working_size: int = 1024,
    seed: int = 0,
) -> QuantizationResult:
    """Cluster pixels in CIE Lab space with MiniBatchKMeans."""
    raise NotImplementedError


def quantize_median_cut(image: DecodedImage, colors: int) -> QuantizationResult:
    """Quantize using Pillow's median cut without dithering."""
    raise NotImplementedError
