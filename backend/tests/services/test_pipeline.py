import logging

import numpy as np
import pytest

from app.core.errors import InvalidParameters
from app.services.image_io import TRANSPARENT_LABEL, encode_indexed_png
from app.services.pipeline import (
    background_index,
    clear_border_regions,
    quantize_image,
    suggest_colors,
    to_indexed_png,
    vectorize_image,
)
from app.services.vectorization import TracingOptions
from tests.images import encode, stripes


def test_background_is_the_dominant_border_label() -> None:
    labels = np.zeros((6, 6), dtype=np.uint8)
    labels[2:4, 2:4] = 1  # a centered shape on background 0

    assert background_index(labels) == 0


def test_no_background_when_the_border_is_mixed_or_transparent() -> None:
    stripes = np.repeat(np.array([0, 0, 1, 1, 2, 2], dtype=np.uint8)[None, :], 6, axis=0)
    transparent = np.full((6, 6), TRANSPARENT_LABEL, dtype=np.uint8)
    transparent[2:4, 2:4] = 0

    assert background_index(stripes) is None  # the best color has 8 of 20 border pixels
    assert background_index(transparent) is None


T = TRANSPARENT_LABEL


def _ring(size: int = 7) -> np.ndarray:
    """Background 0 around a ring of 1 with a center of 0, e.g. white around an eye."""
    labels = np.zeros((size, size), dtype=np.uint8)
    labels[1:-1, 1:-1] = 1
    labels[size // 2, size // 2] = 0
    return labels


def test_clears_the_background_but_not_the_same_color_inside() -> None:
    cleared = clear_border_regions(_ring(), [0])

    assert (cleared[0] == T).all() and (cleared[:, -1] == T).all()
    assert cleared[3, 3] == 0  # enclosed by the ring: kept
    assert (cleared[1:-1, 1:-1][_ring()[1:-1, 1:-1] == 1] == 1).all()


def test_the_background_does_not_seep_in_diagonally() -> None:
    labels = np.zeros((6, 6), dtype=np.uint8)
    labels[1:5, 1:5] = 1
    labels[2:4, 2:4] = 0  # inside the ring
    labels[1, 1] = 0  # a notch in the ring's corner: outside, touching [2, 2] diagonally

    cleared = clear_border_regions(labels, [0])

    assert cleared[1, 1] == T
    assert (cleared[2:4, 2:4] == 0).all()


def test_the_background_passes_through_transparent_pixels() -> None:
    labels = _ring(7)
    labels[0] = T  # already transparent top row
    labels[1, 0] = 0

    cleared = clear_border_regions(labels, [0])

    assert cleared[1, 0] == T
    assert cleared[3, 3] == 0


def test_vectorizes_without_the_background_but_with_the_same_color_inside() -> None:
    labels = np.zeros((24, 24), dtype=np.uint8)
    labels[6:18, 6:18] = 1
    labels[10:14, 10:14] = 0
    png = encode_indexed_png(labels, np.array([[255, 255, 255], [0, 0, 0]], np.uint8), None)

    def coverage(
        transparent: list[int] | None = None, background: list[int] | None = None
    ) -> float:
        result = vectorize_image(
            png,
            max_dimension=64,
            options=TracingOptions(),
            transparent=transparent,
            background=background,
        )
        return float(result.coverage[0])

    assert coverage(background=[0]) == pytest.approx(16 / 144)  # the 4 x 4 center
    assert coverage(transparent=[0]) == 0
    with pytest.raises(InvalidParameters, match="below 2"):
        coverage(background=[2])


def _logged(caplog: pytest.LogCaptureFixture, message: str) -> dict[str, object]:
    [record] = [r for r in caplog.records if r.getMessage() == message]
    return record.__dict__


def test_quantizing_logs_the_input_parameters_and_step_durations(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="app.services.pipeline")

    quantize_image(encode(stripes()), colors=3, algorithm="median_cut", max_dimension=4096)

    fields = _logged(caplog, "quantized image")
    assert (fields["colors"], fields["algorithm"], fields["smooth"]) == (3, "median_cut", 0)
    assert isinstance(fields["width"], int) and isinstance(fields["height"], int)
    assert isinstance(fields["decode_ms"], int) and isinstance(fields["quantize_ms"], int)


def test_vectorizing_an_indexed_png_logs_decoding_and_tracing(
    caplog: pytest.LogCaptureFixture,
) -> None:
    _, quantized, _ = quantize_image(
        encode(stripes()), colors=3, algorithm="kmeans", max_dimension=4096
    )
    caplog.set_level(logging.INFO, logger="app.services.pipeline")

    result = vectorize_image(
        to_indexed_png(quantized), max_dimension=4096, options=TracingOptions(mode="polygon")
    )

    fields = _logged(caplog, "vectorized image")
    assert (fields["mode"], fields["colors"]) == ("polygon", 3)
    assert fields["path_count"] == result.path_count
    assert isinstance(fields["decode_ms"], int) and isinstance(fields["trace_ms"], int)


def test_one_shot_vectorizing_logs_quantizing_separately(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="app.services.pipeline")

    vectorize_image(encode(stripes()), max_dimension=4096, options=TracingOptions(), colors=3)

    assert "decode_ms" in _logged(caplog, "quantized image")
    assert "decode_ms" not in _logged(caplog, "vectorized image")


def test_suggesting_colors_logs_the_suggestion_and_durations(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="app.services.pipeline")

    suggestion = suggest_colors(encode(stripes()), min_colors=2, max_colors=8, max_dimension=4096)

    fields = _logged(caplog, "suggested color count")
    assert fields["suggested_colors"] == suggestion.colors
    assert isinstance(fields["suggest_ms"], int)
