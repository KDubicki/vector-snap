"""Color quantization: reduce an image to N representative colors.

See docs/06-image-processing-pipeline.md, section 3.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageFilter
from sklearn.cluster import KMeans, MiniBatchKMeans

from app.services.image_io import TRANSPARENT_LABEL, DecodedImage

__all__ = [
    "TRANSPARENT_LABEL",
    "ColorSuggestion",
    "QuantizationResult",
    "quantize_filaments",
    "quantize_kmeans",
    "quantize_median_cut",
    "smooth_regions",
    "suggest_color_count",
]

# `smooth_regions` strength n uses a (2n + 1) x (2n + 1) majority window.
MAX_SMOOTH = 3

# Color count suggestion: a mean error (CIE76 ΔE) at or below this is hard to tell apart
# from the original; above `_SUGGEST_MAX_COLORS` the gain rarely justifies the extra paths.
SUGGEST_TARGET_DELTA_E = 5.0
_SUGGEST_MAX_COLORS = 24
_SUGGEST_WORKING_SIZE = 128

# Choosing filaments works on a small copy: the choice depends on color shares, not detail.
FILAMENT_WORKING_SIZE = 256
# Rounds of trying to swap a chosen filament for a better one after the greedy choice.
_FILAMENT_SWAP_ROUNDS = 3
# A filament is only used when it lowers the mean color difference (ΔE) by at least this:
# below it, it mostly reproduces anti-aliased edge pixels, not a color of the design.
FILAMENT_MIN_GAIN = 0.5

# D65 reference white and sRGB -> XYZ matrix.
_WHITE_D65 = np.array([0.95047, 1.0, 1.08883])
_SRGB_TO_XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]
)


@dataclass(frozen=True)
class QuantizationResult:
    labels: NDArray[np.uint8]  # H x W palette indices, TRANSPARENT_LABEL for transparent pixels
    palette: NDArray[np.uint8]  # N x 3, sorted by coverage descending
    coverage: NDArray[np.float64]  # N, fraction of opaque pixels

    @property
    def has_transparency(self) -> bool:
        return bool((self.labels == TRANSPARENT_LABEL).any())


@dataclass(frozen=True)
class ColorSuggestion:
    colors: int
    # (color count, mean ΔE) for every evaluated count; empty for flat images.
    errors: list[tuple[int, float]]


def srgb_to_lab(rgb: NDArray[np.uint8]) -> NDArray[np.float64]:
    """Convert N x 3 sRGB colors to CIE Lab (D65)."""
    c = rgb.astype(np.float64) / 255.0
    linear = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    xyz = (linear @ _SRGB_TO_XYZ.T) / _WHITE_D65
    delta = 6.0 / 29.0
    f = np.where(xyz > delta**3, np.cbrt(xyz), xyz / (3 * delta**2) + 4.0 / 29.0)
    lab: NDArray[np.float64] = np.empty(f.shape, dtype=np.float64)
    lab[:, 0] = 116.0 * f[:, 1] - 16.0
    lab[:, 1] = 500.0 * (f[:, 0] - f[:, 1])
    lab[:, 2] = 200.0 * (f[:, 1] - f[:, 2])
    return lab


def _pack(rgb: NDArray[np.uint8]) -> NDArray[np.uint32]:
    c = rgb.astype(np.uint32)
    packed: NDArray[np.uint32] = np.asarray(
        (c[:, 0] << 16) | (c[:, 1] << 8) | c[:, 2], dtype=np.uint32
    )
    return packed


def _unpack(packed: NDArray[np.uint32]) -> NDArray[np.uint8]:
    return np.stack([(packed >> 16) & 0xFF, (packed >> 8) & 0xFF, packed & 0xFF], axis=1).astype(
        np.uint8
    )


def _nearest(
    points: NDArray[np.float64], centers: NDArray[np.float64], chunk: int = 65536
) -> NDArray[np.intp]:
    """Index of the nearest center for every point, computed in chunks to bound memory."""
    nearest = np.empty(len(points), dtype=np.intp)
    for start in range(0, len(points), chunk):
        block = points[start : start + chunk]
        distances = ((block[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        nearest[start : start + chunk] = distances.argmin(axis=1)
    return nearest


def _pin_locked(
    centers: NDArray[np.float64], locked: list[tuple[int, int, int]]
) -> dict[int, tuple[int, int, int]]:
    """Replace each locked color's nearest still-free center (Lab) with the color itself.

    Greedy, in the order given; colors beyond the number of centers are ignored. Updates
    `centers` in place and returns the pinned colors by center index.
    """
    pinned: dict[int, tuple[int, int, int]] = {}
    for color in locked[: len(centers)]:
        color_lab = srgb_to_lab(np.array([color], dtype=np.uint8))
        distances = ((centers - color_lab) ** 2).sum(axis=1)
        distances[list(pinned)] = np.inf
        index = int(distances.argmin())
        centers[index] = color_lab[0]
        pinned[index] = color
    return pinned


def _finalize(
    image: DecodedImage, opaque_labels: NDArray[np.intp], palette: NDArray[np.uint8]
) -> QuantizationResult:
    """Drop empty clusters, sort the palette by coverage and build the full label map."""
    counts = np.bincount(opaque_labels, minlength=len(palette))
    order = [int(i) for i in np.argsort(-counts, kind="stable") if counts[i] > 0]
    remap = np.zeros(len(palette), dtype=np.uint8)
    remap[order] = np.arange(len(order), dtype=np.uint8)

    labels = np.full((image.height, image.width), TRANSPARENT_LABEL, dtype=np.uint8)
    labels[image.alpha_mask] = remap[opaque_labels]
    sorted_counts = counts[order].astype(np.float64)
    return QuantizationResult(
        labels=labels,
        palette=palette[order],
        coverage=sorted_counts / sorted_counts.sum(),
    )


def quantize_kmeans(
    image: DecodedImage,
    colors: int,
    *,
    locked_colors: list[tuple[int, int, int]] | None = None,
    max_working_size: int = 1024,
    seed: int = 0,
) -> QuantizationResult:
    """Cluster pixels in CIE Lab space with MiniBatchKMeans.

    Clustering runs on the unique colors of a downscaled copy (weighted by pixel count);
    every unique color of the full-resolution image is then assigned to its nearest
    centroid. Palette entries are the mean color of their members, except locked colors,
    which are kept exactly.
    """
    locked = locked_colors or []
    opaque = image.rgb[image.alpha_mask]
    unique, inverse, counts = np.unique(_pack(opaque), return_inverse=True, return_counts=True)

    if len(unique) <= colors and not locked:
        # Already flat enough (logos, icons): keep the exact colors.
        return _finalize(image, inverse.astype(np.intp), _unpack(unique))

    working = _working_sample(image, max_working_size)
    w_unique, w_counts = np.unique(_pack(working), return_counts=True)
    w_lab = srgb_to_lab(_unpack(w_unique))
    if len(w_unique) <= colors:
        # Every color can be its own cluster. k-means would not reliably find that (it can
        # return duplicate centers and merge colors), so use the colors directly.
        centers = w_lab
    else:
        kmeans = MiniBatchKMeans(
            n_clusters=colors, random_state=seed, n_init=3, batch_size=4096
        ).fit(w_lab, sample_weight=w_counts)
        centers = kmeans.cluster_centers_

    pinned = _pin_locked(centers, locked)

    unique_labels = _nearest(srgb_to_lab(_unpack(unique)), centers)
    palette = np.zeros((len(centers), 3), dtype=np.uint8)
    unique_rgb = _unpack(unique).astype(np.float64)
    for k in range(len(centers)):
        if k in pinned:
            palette[k] = pinned[k]
            continue
        members = unique_labels == k
        if members.any():
            weights = counts[members][:, None]
            palette[k] = np.rint((unique_rgb[members] * weights).sum(axis=0) / weights.sum())

    return _finalize(image, unique_labels[inverse], palette)


def quantize_filaments(
    image: DecodedImage,
    filaments: list[tuple[int, int, int]],
    colors: int,
    *,
    locked_colors: list[tuple[int, int, int]] | None = None,
    max_working_size: int = FILAMENT_WORKING_SIZE,
) -> QuantizationResult:
    """Reduce the image to at most `colors` of the given filament colors, used exactly.

    For 3D printing the palette has to be colors that exist as filament. Instead of
    averaging pixels into new colors, this picks the subset of `filaments` that represents
    the image best — the smallest mean color difference (CIE76 ΔE, weighted by pixel
    count) — greedily, then improves it by swapping chosen filaments for unchosen ones.
    Locked colors are always used. Filaments that improve the mean ΔE by less than
    `FILAMENT_MIN_GAIN` are left out — they would only reproduce anti-aliased edges — so
    fewer than `colors` can come back (fewer AMS slots, fewer color changes).
    """
    candidates = list(dict.fromkeys([*(locked_colors or []), *filaments]))
    forced = len(dict.fromkeys(locked_colors or []))
    candidate_lab = srgb_to_lab(np.array(candidates, dtype=np.uint8))

    working = _working_sample(image, max_working_size)
    w_unique, w_counts = np.unique(_pack(working), return_counts=True)
    distances = _lab_distances(srgb_to_lab(_unpack(w_unique)), candidate_lab)
    chosen = _choose_filaments(distances, w_counts.astype(np.float64), colors, forced)

    opaque = image.rgb[image.alpha_mask]
    unique, inverse = np.unique(_pack(opaque), return_inverse=True)
    unique_labels = _nearest(srgb_to_lab(_unpack(unique)), candidate_lab[chosen])
    palette = np.array([candidates[i] for i in chosen], dtype=np.uint8)
    return _finalize(image, unique_labels[inverse], palette)


def _lab_distances(
    points: NDArray[np.float64], centers: NDArray[np.float64]
) -> NDArray[np.float64]:
    """ΔE (CIE76) from every point to every center, without an N x C x 3 temporary."""
    squared = (
        (points**2).sum(axis=1)[:, None]
        + (centers**2).sum(axis=1)[None, :]
        - 2 * points @ centers.T
    )
    distances: NDArray[np.float64] = np.sqrt(np.maximum(squared, 0))
    return distances


def _choose_filaments(
    distances: NDArray[np.float64], weights: NDArray[np.float64], limit: int, forced: int
) -> list[int]:
    """Columns of `distances` (colors x candidates) with the smallest weighted error.

    The first `forced` candidates are always chosen. Greedy forward selection adds the
    candidate that lowers the mean error most, while it lowers it by `FILAMENT_MIN_GAIN`
    and `limit` is not reached; rounds of swaps then replace a chosen candidate by an
    unchosen one while that lowers the error; finally candidates whose removal costs less
    than `FILAMENT_MIN_GAIN` are dropped (e.g. a middle gray picked first, which the later
    picks made redundant).
    """
    limit = max(limit, forced, 1)
    min_gain = FILAMENT_MIN_GAIN * float(weights.sum())

    def error(columns: list[int]) -> float:
        return float((distances[:, columns].min(axis=1) * weights).sum())

    def totals_with(columns: list[int]) -> NDArray[np.float64]:
        """Error of `columns` plus each candidate (inf for candidates already in)."""
        base = distances[:, columns].min(axis=1) if columns else np.full(len(weights), np.inf)
        totals: NDArray[np.float64] = (np.minimum(base[:, None], distances) * weights[:, None]).sum(
            axis=0
        )
        totals[columns] = np.inf
        return totals

    chosen = list(range(forced))
    while len(chosen) < min(limit, distances.shape[1]):
        totals = totals_with(chosen)
        best = int(totals.argmin())
        if chosen and totals[best] > error(chosen) - min_gain:
            break
        chosen.append(best)

    for _ in range(_FILAMENT_SWAP_ROUNDS):
        improved = False
        for position in range(forced, len(chosen)):
            totals = totals_with(chosen[:position] + chosen[position + 1 :])
            best = int(totals.argmin())
            if totals[best] < error(chosen) - 1e-9:
                chosen[position] = best
                improved = True
        if not improved:
            break

    while len(chosen) > max(forced, 1):
        costs = [
            error(chosen[:i] + chosen[i + 1 :]) - error(chosen) for i in range(forced, len(chosen))
        ]
        cheapest = int(np.argmin(costs))
        if costs[cheapest] >= min_gain:
            break
        del chosen[forced + cheapest]
    return chosen


def _working_sample(image: DecodedImage, max_working_size: int) -> NDArray[np.uint8]:
    if max(image.width, image.height) <= max_working_size:
        return image.rgb[image.alpha_mask]
    scale = max_working_size / max(image.width, image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    rgb = np.asarray(Image.fromarray(image.rgb).resize(size, Image.Resampling.LANCZOS))
    mask = np.asarray(
        Image.fromarray(image.alpha_mask.astype(np.uint8) * 255).resize(
            size, Image.Resampling.NEAREST
        )
    )
    sample: NDArray[np.uint8] = rgb[mask > 0]
    return sample if len(sample) else image.rgb[image.alpha_mask]


def quantize_median_cut(
    image: DecodedImage,
    colors: int,
    *,
    locked_colors: list[tuple[int, int, int]] | None = None,
) -> QuantizationResult:
    """Quantize using Pillow's median cut without dithering.

    Locked colors replace their nearest palette entries; pixels are then reassigned to the
    nearest entry of the adjusted palette in Lab space.
    """
    rgb = image.rgb.copy()
    # Transparent pixels must not influence the palette: paint them with an opaque color.
    rgb[~image.alpha_mask] = image.rgb[image.alpha_mask][0]
    quantized = Image.fromarray(rgb).quantize(
        colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
    )
    labels = np.asarray(quantized, dtype=np.intp)
    raw_palette = quantized.getpalette() or []
    palette = np.asarray(raw_palette, dtype=np.uint8).reshape(-1, 3)[: int(labels.max()) + 1]
    if not locked_colors:
        return _finalize(image, labels[image.alpha_mask], palette)

    centers = srgb_to_lab(palette)
    for index, color in _pin_locked(centers, locked_colors).items():
        palette[index] = color
    opaque = image.rgb[image.alpha_mask]
    unique, inverse = np.unique(_pack(opaque), return_inverse=True)
    unique_labels = _nearest(srgb_to_lab(_unpack(unique)), centers)
    return _finalize(image, unique_labels[inverse.reshape(-1)], palette)


def smooth_regions(result: QuantizationResult, strength: int) -> QuantizationResult:
    """Replace every opaque pixel with the most common color around it (majority filter).

    Removes specks and noise and evens out jagged color edges, so photos and scans trace
    into fewer, cleaner shapes (thin, printable-sized details survive only at low
    strength). Transparency is left unchanged; colors that disappear are dropped and the
    palette is re-sorted by coverage.
    """
    if strength <= 0:
        return result
    size = 2 * min(strength, MAX_SMOOTH) + 1
    filtered = np.asarray(
        Image.fromarray(result.labels, mode="L").filter(ImageFilter.ModeFilter(size))
    )
    opaque = result.labels != TRANSPARENT_LABEL
    # A majority of transparent neighbours must not erase an opaque pixel.
    keep = opaque & (filtered != TRANSPARENT_LABEL)
    labels = np.where(keep, filtered, result.labels)

    counts = np.bincount(labels[opaque], minlength=len(result.palette))
    order = [int(i) for i in np.argsort(-counts, kind="stable") if counts[i] > 0]
    remap = np.full(256, TRANSPARENT_LABEL, dtype=np.uint8)
    remap[order] = np.arange(len(order), dtype=np.uint8)
    sorted_counts = counts[order].astype(np.float64)
    return QuantizationResult(
        labels=remap[labels],
        palette=result.palette[order],
        coverage=sorted_counts / sorted_counts.sum(),
    )


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
    unique_count = len(np.unique(_pack(opaque)))
    if unique_count <= max_colors:
        return ColorSuggestion(colors=max(min_colors, unique_count), errors=[])

    working = _working_sample(image, _SUGGEST_WORKING_SIZE)
    w_unique, w_counts = np.unique(_pack(working), return_counts=True)
    if len(w_unique) <= min_colors:
        return ColorSuggestion(colors=min_colors, errors=[])
    lab = srgb_to_lab(_unpack(w_unique))
    weights = w_counts.astype(np.float64)
    upper = min(max_colors, _SUGGEST_MAX_COLORS, len(w_unique))

    errors: list[tuple[int, float]] = []
    for k in range(min_colors, upper + 1):
        kmeans = KMeans(n_clusters=k, random_state=seed, n_init=1, max_iter=100)
        centers = kmeans.fit(lab, sample_weight=weights).cluster_centers_
        nearest = centers[_nearest(lab, centers)]
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
