import numpy as np

from app.services.image_io import TRANSPARENT_LABEL
from app.services.pipeline import background_index


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
