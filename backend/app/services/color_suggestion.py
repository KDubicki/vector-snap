"""Suggest how many colors represent an image well (`POST /suggest-colors`).

See docs/06-image-processing-pipeline.md, section 3.
"""

from dataclasses import dataclass

import numpy as np
from sklearn.cluster import KMeans

from app.services.color_science import nearest_center, pack_rgb, srgb_to_lab, unpack_rgb
from app.services.image_io import DecodedImage
from app.services.quantization import working_sample

# Color count suggestion: a mean error (CIE76 ΔE) at or below this is hard to tell apart
# from the original; above `_SUGGEST_MAX_COLORS` the gain rarely justifies the extra paths.
SUGGEST_TARGET_DELTA_E = 5.0
_SUGGEST_MAX_COLORS = 24
_SUGGEST_WORKING_SIZE = 128


@dataclass(frozen=True)
class ColorSuggestion:
    colors: int
    # (color count, mean ΔE) for every evaluated count; empty for flat images.
    errors: list[tuple[int, float]]


def suggest_color_count(
    image: DecodedImage,
    *,
    min_colors: int,
    max_colors: int,
    target_delta_e: float = SUGGEST_TARGET_DELTA_E,
    seed: int = 0,
) -> ColorSuggestion:
    """Suggest how many colors represent the image well.

    Flat images (no more unique colors than `max_colors`) get their exact color count.
    Otherwise k-means runs on a small copy for increasing color counts and the smallest
    count whose mean error (ΔE in Lab) is at most `target_delta_e` wins; if none is good
    enough, the elbow of the error curve is used.
    """
    opaque = image.rgb[image.alpha_mask]
    unique_count = len(np.unique(pack_rgb(opaque)))
    if unique_count <= max_colors:
        return ColorSuggestion(colors=max(min_colors, unique_count), errors=[])

    working = working_sample(image, _SUGGEST_WORKING_SIZE)
    w_unique, w_counts = np.unique(pack_rgb(working), return_counts=True)
    if len(w_unique) <= min_colors:
        return ColorSuggestion(colors=min_colors, errors=[])
    lab = srgb_to_lab(unpack_rgb(w_unique))
    weights = w_counts.astype(np.float64)
    upper = min(max_colors, _SUGGEST_MAX_COLORS, len(w_unique))

    errors: list[tuple[int, float]] = []
    for k in range(min_colors, upper + 1):
        kmeans = KMeans(n_clusters=k, random_state=seed, n_init=1, max_iter=100)
        centers = kmeans.fit(lab, sample_weight=weights).cluster_centers_
        nearest = centers[nearest_center(lab, centers)]
        distance = np.sqrt(((lab - nearest) ** 2).sum(axis=1))
        errors.append((k, float((distance * weights).sum() / weights.sum())))
        if errors[-1][1] <= target_delta_e:
            return ColorSuggestion(colors=k, errors=errors)
    return ColorSuggestion(colors=_elbow(errors), errors=errors)


def _elbow(errors: list[tuple[int, float]]) -> int:
    """Color count farthest below the line joining the first and last points of the curve."""
    counts = np.array([k for k, _ in errors], dtype=np.float64)
    values = np.array([e for _, e in errors], dtype=np.float64)
    if values[0] == values[-1]:
        return int(counts[0])
    if len(errors) < 3:
        return int(counts[-1])
    x = (counts - counts[0]) / (counts[-1] - counts[0])
    y = (values - values[-1]) / (values[0] - values[-1])
    return int(counts[int(np.argmax((1 - x) - y))])
