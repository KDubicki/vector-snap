from collections.abc import Callable

import numpy as np
import pytest
from PIL import Image

from app.services.image_io import DecodedImage, decode_image
from app.services.quantization import (
    SUGGEST_TARGET_DELTA_E,
    TRANSPARENT_LABEL,
    QuantizationResult,
    merge_small_colors,
    quantize_filaments,
    quantize_kmeans,
    quantize_median_cut,
    smooth_regions,
    srgb_to_lab,
    suggest_color_count,
)
from tests.images import (
    BLUE,
    GREEN,
    RED,
    encode,
    gradient,
    noisy,
    stripes,
    with_transparent_corner,
)


def test_srgb_to_lab_reference_points() -> None:
    lab = srgb_to_lab(np.array([[255, 255, 255], [0, 0, 0]], dtype=np.uint8))

    assert lab[0] == pytest.approx([100.0, 0.0, 0.0], abs=0.01)
    assert lab[1] == pytest.approx([0.0, 0.0, 0.0], abs=0.01)


def test_flat_image_keeps_exact_colors_sorted_by_coverage() -> None:
    image = decode_image(encode(stripes()), max_dimension=64)

    result = quantize_kmeans(image, colors=8)

    assert [tuple(c) for c in result.palette] == [RED, GREEN, BLUE]
    assert result.coverage == pytest.approx([0.6, 0.3, 0.1])
    assert result.labels[0].tolist() == [0] * 6 + [1] * 3 + [2]


def test_kmeans_reduces_noisy_image_to_requested_colors() -> None:
    image = decode_image(encode(noisy()), max_dimension=64)

    result = quantize_kmeans(image, colors=4)

    assert len(result.palette) == 4
    assert result.coverage == pytest.approx([0.25] * 4, abs=0.02)
    # Each block maps to a single label.
    assert len(np.unique(result.labels[:16, :16])) == 1
    assert int(np.abs(result.palette.astype(int) - [200, 30, 30]).sum(axis=1).min()) < 10


def test_kmeans_is_deterministic_for_a_seed() -> None:
    image = decode_image(encode(noisy()), max_dimension=64)

    first = quantize_kmeans(image, colors=3, seed=7)
    second = quantize_kmeans(image, colors=3, seed=7)

    assert np.array_equal(first.palette, second.palette)
    assert np.array_equal(first.labels, second.labels)


def test_kmeans_downscales_large_images_for_clustering() -> None:
    image = decode_image(encode(noisy().resize((128, 128))), max_dimension=256)

    result = quantize_kmeans(image, colors=4, max_working_size=64)

    assert result.labels.shape == (128, 128)
    assert len(result.palette) == 4


def test_locked_colors_appear_exactly_in_palette() -> None:
    image = decode_image(encode(noisy()), max_dimension=64)

    result = quantize_kmeans(image, colors=4, locked_colors=[(255, 0, 0)])

    assert (255, 0, 0) in [tuple(int(v) for v in c) for c in result.palette]


def test_locking_a_color_keeps_every_color_of_a_flat_image() -> None:
    image = decode_image(encode(stripes()), max_dimension=64)

    result = quantize_kmeans(image, colors=8, locked_colors=[(250, 0, 0)])

    palette = sorted(tuple(int(v) for v in c) for c in result.palette)
    assert palette == sorted([(250, 0, 0), GREEN, BLUE])


@pytest.mark.parametrize("algorithm", [quantize_kmeans, quantize_median_cut])
def test_transparent_pixels_get_transparent_label(
    algorithm: Callable[[DecodedImage, int], QuantizationResult],
) -> None:
    image = decode_image(encode(with_transparent_corner(stripes())), max_dimension=64)

    result = algorithm(image, 3)

    assert (result.labels[:2, :2] == TRANSPARENT_LABEL).all()
    assert TRANSPARENT_LABEL not in result.labels[2:]
    assert result.has_transparency
    assert result.coverage.sum() == pytest.approx(1.0)


def test_median_cut_limits_palette_size() -> None:
    image = decode_image(encode(noisy()), max_dimension=64)

    result = quantize_median_cut(image, colors=4)

    assert 1 <= len(result.palette) <= 4
    assert list(result.coverage) == sorted(result.coverage, reverse=True)


def test_median_cut_keeps_locked_colors_exactly() -> None:
    image = decode_image(encode(noisy()), max_dimension=64)

    result = quantize_median_cut(image, colors=4, locked_colors=[(255, 0, 0), (0, 0, 255)])

    palette = [tuple(int(v) for v in c) for c in result.palette]
    assert (255, 0, 0) in palette
    assert (0, 0, 255) in palette
    assert len(palette) <= 4
    assert result.coverage.sum() == pytest.approx(1.0)


def test_median_cut_assigns_pixels_to_the_pinned_color() -> None:
    image = decode_image(encode(stripes()), max_dimension=64)
    # A shade close to the red stripe takes its place; red pixels must now use it.
    locked = (230, 20, 20)

    result = quantize_median_cut(image, colors=3, locked_colors=[locked])

    palette = [tuple(int(v) for v in c) for c in result.palette]
    assert locked in palette
    assert RED not in palette
    red_pixels = (image.rgb == RED).all(axis=2)
    assert (result.labels[red_pixels] == palette.index(locked)).all()


def test_suggestion_for_flat_image_is_its_color_count() -> None:
    image = decode_image(encode(stripes()), max_dimension=64)

    suggestion = suggest_color_count(image, min_colors=2, max_colors=64)

    assert suggestion.colors == 3
    assert suggestion.errors == []


def test_suggestion_respects_the_minimum_color_count() -> None:
    image = decode_image(encode(stripes(colors=(RED,), widths=(4,))), max_dimension=64)

    assert suggest_color_count(image, min_colors=2, max_colors=64).colors == 2


def test_suggestion_finds_the_color_blocks_of_a_noisy_image() -> None:
    image = decode_image(encode(noisy()), max_dimension=64)

    suggestion = suggest_color_count(image, min_colors=2, max_colors=64)

    assert suggestion.colors == 4
    assert suggestion.errors[-1][0] == 4
    assert suggestion.errors[-1][1] <= SUGGEST_TARGET_DELTA_E


def test_suggestion_falls_back_to_the_elbow_for_gradients() -> None:
    image = decode_image(encode(gradient()), max_dimension=128)

    suggestion = suggest_color_count(image, min_colors=2, max_colors=12)

    counts = [k for k, _ in suggestion.errors]
    assert counts == list(range(2, 13))
    assert all(error > SUGGEST_TARGET_DELTA_E for _, error in suggestion.errors)
    assert 3 <= suggestion.colors < 12
    assert suggestion.colors == suggest_color_count(image, min_colors=2, max_colors=12).colors


def test_suggestion_never_exceeds_the_maximum() -> None:
    image = decode_image(encode(gradient()), max_dimension=128)

    suggestion = suggest_color_count(image, min_colors=2, max_colors=3)

    assert suggestion.colors in (2, 3)


def _labels_result(labels: list[list[int]], colors: int) -> QuantizationResult:
    array = np.array(labels, dtype=np.uint8)
    palette = np.array([[i * 40, 0, 0] for i in range(colors)], dtype=np.uint8)
    counts = np.bincount(array[array != TRANSPARENT_LABEL], minlength=colors)
    return QuantizationResult(labels=array, palette=palette, coverage=counts / counts.sum())


def test_smoothing_removes_specks_and_drops_vanished_colors() -> None:
    labels = np.zeros((9, 9), dtype=np.uint8)
    labels[:, 5:] = 1
    labels[2, 2] = 2  # a lone speck inside color 0
    result = smooth_regions(_labels_result(labels.tolist(), 3), 1)

    assert len(result.palette) == 2
    assert (result.labels[:, :5] == 0).all()
    assert (result.labels[:, 5:] == 1).all()
    assert result.coverage == pytest.approx([5 / 9, 4 / 9])


def test_smoothing_re_sorts_the_palette_by_coverage() -> None:
    labels = np.ones((6, 6), dtype=np.uint8)
    labels[:, :2] = 0  # palette index 0 covers less than index 1
    result = smooth_regions(_labels_result(labels.tolist(), 2), 1)

    assert result.palette.tolist() == [[40, 0, 0], [0, 0, 0]]
    assert result.coverage == pytest.approx([2 / 3, 1 / 3])
    assert (result.labels[:, :2] == 1).all()


def test_smoothing_keeps_transparency() -> None:
    t = TRANSPARENT_LABEL
    labels = [[t, t, t, t], [t, 0, 0, 0], [t, 0, 1, 0], [t, 0, 0, 0]]
    result = smooth_regions(_labels_result(labels, 2), 1)

    assert (result.labels == TRANSPARENT_LABEL).tolist() == (
        np.array(labels) == TRANSPARENT_LABEL
    ).tolist()
    assert result.palette.tolist() == [[0, 0, 0]]


def test_smoothing_off_returns_the_result_unchanged() -> None:
    original = _labels_result([[0, 1], [1, 0]], 2)

    assert smooth_regions(original, 0) is original


def test_suggestion_when_rare_colors_vanish_from_the_working_sample() -> None:
    # Two single pixels one level off red: three colors, more than allowed, but they
    # vanish when the 4096 px image is reduced to the 128 px working sample.
    image = np.zeros((64, 4096, 3), dtype=np.uint8)
    image[...] = RED
    image[10, 1000] = (255, 0, 1)
    image[50, 3000] = (255, 1, 0)
    decoded = decode_image(encode(Image.fromarray(image)), 4096)

    suggestion = suggest_color_count(decoded, min_colors=2, max_colors=2)

    assert suggestion.colors == 2
    assert suggestion.errors == []


def test_suggestion_with_two_candidate_counts_takes_the_larger() -> None:
    image = decode_image(encode(gradient()), 4096)

    suggestion = suggest_color_count(image, min_colors=2, max_colors=3, target_delta_e=0)

    assert [k for k, _ in suggestion.errors] == [2, 3]
    assert suggestion.colors == 3


def test_suggestion_with_a_single_candidate_count_takes_it() -> None:
    image = decode_image(encode(gradient()), 4096)

    suggestion = suggest_color_count(image, min_colors=3, max_colors=3, target_delta_e=0)

    assert [k for k, _ in suggestion.errors] == [3]
    assert suggestion.colors == 3


WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
GRAY = (128, 128, 128)
YELLOW = (240, 220, 0)
FILAMENTS = [WHITE, BLACK, (200, 30, 30), (20, 140, 40), (10, 30, 200), YELLOW]


def _decoded(image: Image.Image) -> DecodedImage:
    return decode_image(encode(image), 4096)


def test_filaments_pick_the_closest_filaments_and_use_their_exact_colors() -> None:
    result = quantize_filaments(_decoded(stripes()), FILAMENTS, 3)

    assert [tuple(c) for c in result.palette] == [(200, 30, 30), (20, 140, 40), (10, 30, 200)]
    assert result.coverage.tolist() == pytest.approx([0.6, 0.3, 0.1])
    assert result.labels.tolist()[0] == [0] * 6 + [1] * 3 + [2]


def test_filaments_that_do_not_help_are_left_out() -> None:
    image = stripes(colors=(RED, BLUE), widths=(5, 5))

    result = quantize_filaments(_decoded(image), FILAMENTS, 5)

    assert len(result.palette) == 2


def test_filaments_do_not_spend_a_slot_on_two_similar_colors() -> None:
    # Two close greens (a shaded area) and a red detail: k-means would split the greens.
    image = stripes(colors=((20, 140, 40), (35, 125, 50), RED), widths=(5, 4, 1))
    greens = [(20, 140, 40), (35, 125, 50), (200, 30, 30)]

    result = quantize_filaments(_decoded(image), greens, 2)

    assert [tuple(c) for c in result.palette] == [(20, 140, 40), (200, 30, 30)]


def test_filament_swaps_improve_on_the_greedy_choice() -> None:
    # Gray is the best single filament, but black and white together beat gray + one.
    image = stripes(colors=(BLACK, WHITE), widths=(5, 5))

    result = quantize_filaments(_decoded(image), [GRAY, BLACK, WHITE], 2)

    assert sorted(tuple(c) for c in result.palette) == [BLACK, WHITE]


def test_locked_filaments_are_always_used() -> None:
    result = quantize_filaments(_decoded(stripes()), FILAMENTS, 2, locked_colors=[YELLOW])

    palette = [tuple(c) for c in result.palette]
    assert YELLOW in palette
    assert len(palette) == 2
    assert (200, 30, 30) in palette  # the largest area gets the other slot


def test_filaments_keep_transparency() -> None:
    result = quantize_filaments(_decoded(with_transparent_corner(stripes())), FILAMENTS, 3)

    assert result.has_transparency


def test_filaments_for_anti_aliased_edges_are_left_out() -> None:
    # A one pixel purple column between red and blue: an edge blend, not a design color.
    purple = (110, 40, 120)
    image = stripes(colors=(RED, purple, BLUE), widths=(100, 1, 100))

    result = quantize_filaments(_decoded(image), [(200, 30, 30), purple, (10, 30, 200)], 3)

    assert sorted(tuple(c) for c in result.palette) == [(10, 30, 200), (200, 30, 30)]


def test_redundant_first_picks_are_dropped() -> None:
    # Gray is the best single pick for black, white and a little red, but once black and
    # white are chosen it adds nothing.
    image = stripes(colors=(BLACK, WHITE, RED), widths=(45, 45, 10))

    result = quantize_filaments(_decoded(image), [GRAY, BLACK, WHITE, (200, 30, 30)], 4)

    assert sorted(tuple(c) for c in result.palette) == sorted([BLACK, WHITE, (200, 30, 30)])


BLACK, WHITE, GRAY, PINK = (0, 0, 0), (255, 255, 255), (70, 70, 70), (255, 200, 200)


def _shares(counts: list[int], palette: list[tuple[int, int, int]]) -> QuantizationResult:
    """A one-row image with `counts[i]` pixels of `palette[i]`, sorted by coverage."""
    labels = np.repeat(np.arange(len(counts), dtype=np.uint8), counts)[None, :]
    total = sum(counts)
    return QuantizationResult(
        labels=labels,
        palette=np.array(palette, dtype=np.uint8),
        coverage=np.array(counts) / total,
    )


def test_merges_a_small_color_into_its_nearest() -> None:
    # Black 60 %, white 38.5 %, a dark gray at 1.5 %: the gray joins the black.
    result, merged = merge_small_colors(_shares([600, 385, 15], [BLACK, WHITE, GRAY]), 0.02)

    assert result.palette.tolist() == [list(BLACK), list(WHITE)]
    assert result.coverage == pytest.approx([0.615, 0.385])
    assert (result.labels[0, 985:] == 0).all()
    assert [(m.color, m.into) for m in merged] == [(GRAY, BLACK)]
    assert merged[0].coverage == pytest.approx(0.015)


def test_merges_smallest_first_and_follows_later_merges() -> None:
    # Gray (1 %) joins black (1.5 %), which then still is small and joins white.
    result, merged = merge_small_colors(_shares([975, 15, 10], [WHITE, BLACK, GRAY]), 0.03)

    assert result.palette.tolist() == [list(WHITE)]
    assert [(m.color, m.into) for m in merged] == [(GRAY, WHITE), (BLACK, WHITE)]


def test_keeps_locked_colors_and_one_color() -> None:
    result, merged = merge_small_colors(
        _shares([980, 20], [WHITE, PINK]), 0.05, locked_colors=[PINK]
    )
    assert merged == []
    assert result.palette.tolist() == [list(WHITE), list(PINK)]

    result, merged = merge_small_colors(_shares([10, 10], [WHITE, BLACK]), 0.9)
    assert len(result.palette) == 1
    assert len(merged) == 1


def test_merging_off_or_nothing_small_returns_the_result_unchanged() -> None:
    original = _shares([600, 400], [BLACK, WHITE])

    assert merge_small_colors(original, 0) == (original, [])
    assert merge_small_colors(original, 0.02) == (original, [])
