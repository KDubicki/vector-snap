"""Color quantization: reduce an image to N representative colors (k-means, median cut
or a choice of the loaded filaments). Cleaning the palette up afterwards is in
`palette_cleanup`, the color science in `color_science`, suggesting a color count in
`color_suggestion`.

See docs/06-image-processing-pipeline.md, section 3.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from sklearn.cluster import MiniBatchKMeans

from app.services.color_science import (
    lab_distances,
    nearest_center,
    pack_rgb,
    srgb_to_lab,
    unpack_rgb,
)
from app.services.image_io import TRANSPARENT_LABEL, DecodedImage

# Choosing filaments works on a small copy: the choice depends on color shares, not detail.
FILAMENT_WORKING_SIZE = 256
# Rounds of trying to swap a chosen filament for a better one after the greedy choice.
_FILAMENT_SWAP_ROUNDS = 3
# A filament is only used when it lowers the mean color difference (ΔE) by at least this:
# below it, it mostly reproduces anti-aliased edge pixels, not a color of the design.
FILAMENT_MIN_GAIN = 0.5


@dataclass(frozen=True)
class QuantizationResult:
    labels: NDArray[np.uint8]  # H x W palette indices, TRANSPARENT_LABEL for transparent pixels
    palette: NDArray[np.uint8]  # N x 3, sorted by coverage descending
    coverage: NDArray[np.float64]  # N, fraction of opaque pixels

    @property
    def has_transparency(self) -> bool:
        return bool((self.labels == TRANSPARENT_LABEL).any())


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
    unique, inverse, counts = np.unique(pack_rgb(opaque), return_inverse=True, return_counts=True)

    if len(unique) <= colors and not locked:
        # Already flat enough (logos, icons): keep the exact colors.
        return _finalize(image, inverse.astype(np.intp), unpack_rgb(unique))

    working = working_sample(image, max_working_size)
    w_unique, w_counts = np.unique(pack_rgb(working), return_counts=True)
    w_lab = srgb_to_lab(unpack_rgb(w_unique))
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

    unique_labels = nearest_center(srgb_to_lab(unpack_rgb(unique)), centers)
    palette = np.zeros((len(centers), 3), dtype=np.uint8)
    unique_rgb = unpack_rgb(unique).astype(np.float64)
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

    working = working_sample(image, max_working_size)
    w_unique, w_counts = np.unique(pack_rgb(working), return_counts=True)
    distances = lab_distances(srgb_to_lab(unpack_rgb(w_unique)), candidate_lab)
    chosen = _choose_filaments(distances, w_counts.astype(np.float64), colors, forced)

    opaque = image.rgb[image.alpha_mask]
    unique, inverse = np.unique(pack_rgb(opaque), return_inverse=True)
    unique_labels = nearest_center(srgb_to_lab(unpack_rgb(unique)), candidate_lab[chosen])
    palette = np.array([candidates[i] for i in chosen], dtype=np.uint8)
    return _finalize(image, unique_labels[inverse], palette)


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


def working_sample(image: DecodedImage, max_working_size: int) -> NDArray[np.uint8]:
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
    unique, inverse = np.unique(pack_rgb(opaque), return_inverse=True)
    unique_labels = nearest_center(srgb_to_lab(unpack_rgb(unique)), centers)
    return _finalize(image, unique_labels[inverse.reshape(-1)], palette)


def resorted(labels: NDArray[np.uint8], palette: NDArray[np.uint8]) -> QuantizationResult:
    """Drop colors no pixel has any more and sort the palette by coverage again."""
    opaque = labels != TRANSPARENT_LABEL
    counts = np.bincount(labels[opaque], minlength=len(palette))
    order = [int(i) for i in np.argsort(-counts, kind="stable") if counts[i] > 0]
    remap = np.full(256, TRANSPARENT_LABEL, dtype=np.uint8)
    remap[order] = np.arange(len(order), dtype=np.uint8)
    sorted_counts = counts[order].astype(np.float64)
    return QuantizationResult(
        labels=remap[labels],
        palette=palette[order],
        coverage=sorted_counts / sorted_counts.sum(),
    )
