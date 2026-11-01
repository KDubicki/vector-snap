"""Palette clean-up after quantization: smoothing specks away and merging colors that
look the same or cover too little of the image, so every color earns its filament.

See docs/06-image-processing-pipeline.md, section 3.
"""

from dataclasses import dataclass, replace
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageFilter

from app.services.color_science import delta_e_2000, srgb_to_lab
from app.services.image_io import TRANSPARENT_LABEL
from app.services.quantization import QuantizationResult, resorted

# `smooth_regions` strength n uses a (2n + 1) x (2n + 1) majority window.
MAX_SMOOTH = 3

# `merge_small_colors` only merges into a color at most this far (CIE76 ΔE): a dark gray
# joins black (ΔE 30-45), but black pupils on a red face (ΔE 93) are a detail, not noise.
MERGE_MAX_DELTA_E = 50.0


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
    return resorted(np.where(keep, filtered, result.labels), result.palette)


@dataclass(frozen=True)
class MergedColor:
    color: tuple[int, int, int]  # the merged color, gone from the palette
    into: tuple[int, int, int]  # the color its pixels now have
    coverage: float  # its share of the opaque pixels before merging
    # `similar`: hard to tell from `into` (`merge_similar_colors`); `small`: too little
    # of the image (`merge_small_colors`).
    reason: Literal["similar", "small"] = "small"
    delta_e: float = 0.0  # CIEDE2000 difference to `into`


def merge_similar_colors(
    result: QuantizationResult,
    max_delta_e: float,
    locked_colors: list[tuple[int, int, int]] | None = None,
) -> tuple[QuantizationResult, list[MergedColor]]:
    """Merge colors closer than `max_delta_e` (CIEDE2000) to each other, whatever their
    share: #ffffff and #fefefe are one color to the eye and should not be two filaments.

    The closest pair goes first, the color covering less joining the one covering more
    (which keeps its value); then the next closest pair, until no two colors are that
    close. Locked colors are never merged away, two locked colors stay apart.
    """
    if max_delta_e <= 0 or len(result.palette) < 2:
        return result, []
    locked = {_rgb(color) for color in np.array(locked_colors or [], dtype=np.uint8)}
    labels = result.labels.copy()
    counts = np.bincount(labels[labels != TRANSPARENT_LABEL], minlength=len(result.palette))
    total = counts.sum()
    lab = srgb_to_lab(result.palette)
    differences = delta_e_2000(lab[:, None, :], lab[None, :, :])
    is_locked = np.array([_rgb(color) in locked for color in result.palette])
    # Pairs that may merge: different, both present, not both locked.
    differences[np.eye(len(lab), dtype=bool)] = np.inf
    differences[np.outer(is_locked, is_locked)] = np.inf
    differences[counts == 0, :] = np.inf
    differences[:, counts == 0] = np.inf
    merged: list[MergedColor] = []
    while True:
        first, second = np.unravel_index(int(differences.argmin()), differences.shape)
        if differences[first, second] >= max_delta_e:
            break
        # The locked color, else the one covering more, stays.
        keep_first = is_locked[first] or (not is_locked[second] and counts[first] >= counts[second])
        into, index = (int(first), int(second)) if keep_first else (int(second), int(first))
        labels[labels == index] = into
        merged.append(
            MergedColor(
                color=_rgb(result.palette[index]),
                into=_rgb(result.palette[into]),
                coverage=float(counts[index] / total),
                reason="similar",
            )
        )
        counts[into] += counts[index]
        counts[index] = 0
        differences[index, :] = np.inf
        differences[:, index] = np.inf
    if not merged:
        return result, []
    return resorted(labels, result.palette), resolve_merges(merged)


def resolve_merges(merged: list[MergedColor]) -> list[MergedColor]:
    """Every merge pointed at the color its pixels end up with, after later merges, and
    with the CIEDE2000 difference to it."""
    final = {item.color: item.into for item in merged}
    resolved = []
    for item in merged:
        target = item.into
        while target in final:
            target = final[target]
        pair = srgb_to_lab(np.array([item.color, target], dtype=np.uint8))
        difference = round(float(delta_e_2000(pair[0], pair[1])), 2)
        resolved.append(replace(item, into=target, delta_e=difference))
    return resolved


def merge_small_colors(
    result: QuantizationResult,
    min_coverage: float,
    locked_colors: list[tuple[int, int, int]] | None = None,
) -> tuple[QuantizationResult, list[MergedColor]]:
    """Merge every color covering less than `min_coverage` of the image into its nearest
    other color (CIE Lab), smallest first, so the palette can end up smaller than asked.

    A gray shading a few pixels joins the black next to it instead of costing a filament
    and a layer of its own. A small color with no other color within `MERGE_MAX_DELTA_E`
    is a detail of its own (black pupils, a red dot) and stays. Shares are counted again
    after every merge; the color merged into keeps its value, locked colors are never
    merged away and one color always stays.
    """
    if min_coverage <= 0 or len(result.palette) < 2:
        return result, []
    locked = {tuple(int(c) for c in color) for color in locked_colors or []}
    labels = result.labels.copy()
    counts = np.bincount(labels[labels != TRANSPARENT_LABEL], minlength=len(result.palette))
    total = counts.sum()
    lab = srgb_to_lab(result.palette)
    alive = counts > 0
    merged: list[MergedColor] = []
    while alive.sum() > 1:
        small = [
            int(i)
            for i in np.argsort(counts, kind="stable")
            if alive[i]
            and counts[i] < min_coverage * total
            and tuple(int(c) for c in result.palette[i]) not in locked
        ]
        pair = next((pair for pair in (_nearest_alive(lab, alive, i) for i in small) if pair), None)
        if pair is None:
            break
        index, into = pair
        labels[labels == index] = into
        merged.append(
            MergedColor(
                color=_rgb(result.palette[index]),
                into=_rgb(result.palette[into]),
                coverage=float(counts[index] / total),
            )
        )
        counts[into] += counts[index]
        counts[index] = 0
        alive[index] = False
    if not merged:
        return result, []
    return resorted(labels, result.palette), resolve_merges(merged)


def _nearest_alive(
    lab: NDArray[np.float64], alive: NDArray[np.bool_], index: int
) -> tuple[int, int] | None:
    """(index, its nearest other alive color) when that is within `MERGE_MAX_DELTA_E`."""
    distances = np.sqrt(((lab - lab[index]) ** 2).sum(axis=1))
    distances[~alive] = np.inf
    distances[index] = np.inf
    into = int(distances.argmin())
    return (index, into) if distances[into] <= MERGE_MAX_DELTA_E else None


def _rgb(color: NDArray[np.uint8]) -> tuple[int, int, int]:
    return int(color[0]), int(color[1]), int(color[2])
