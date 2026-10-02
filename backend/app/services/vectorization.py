"""Raster-to-vector tracing with vtracer.

See docs/06-image-processing-pipeline.md, sections 4-5.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class TracingOptions:
    mode: str = "spline"
    stacking: str = "cutout"
    filter_speckle: int = 4
    corner_threshold: int = 60
    length_threshold: float = 4.0
    splice_threshold: int = 45
    path_precision: int = 2


def trace(labels: NDArray[np.uint8], palette: NDArray[np.uint8], options: TracingOptions) -> str:
    """Render the label map with the final palette and trace it into a raw SVG string."""
    raise NotImplementedError
