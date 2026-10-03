from collections.abc import Callable

import numpy as np
import pytest

from app.services.image_io import DecodedImage, decode_image
from app.services.quantization import (
    TRANSPARENT_LABEL,
    QuantizationResult,
    quantize_kmeans,
    quantize_median_cut,
    srgb_to_lab,
)
from tests.images import BLUE, GREEN, RED, encode, noisy, stripes, with_transparent_corner


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
