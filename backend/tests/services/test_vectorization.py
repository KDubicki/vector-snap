from dataclasses import replace

import numpy as np

from app.services.image_io import TRANSPARENT_LABEL
from app.services.svg_postprocess import extract_paths
from app.services.vectorization import TracingOptions, color_layers, trace

PALETTE = np.array([[255, 0, 0], [0, 255, 0], [0, 0, 255]], dtype=np.uint8)
POLYGON = TracingOptions(mode="polygon", filter_speckle=0)


def _labels() -> np.ndarray:
    labels = np.zeros((8, 10), dtype=np.uint8)
    labels[:, 6:9] = 1
    labels[:, 9] = 2
    return labels


def test_color_layers_group_identical_colors_in_palette_order() -> None:
    palette = np.array([[1, 1, 1], [2, 2, 2], [1, 1, 1]], dtype=np.uint8)

    assert color_layers(palette) == [[0, 2], [1]]


def test_cutout_traces_each_color_separately() -> None:
    layers = trace(_labels(), PALETTE, POLYGON)

    assert [layer.palette_index for layer in layers] == [0, 1, 2]
    assert extract_paths(layers[0].raw_svg, 2) == ["M0,0 L6,0 L6,8 L0,8 Z"]
    assert extract_paths(layers[2].raw_svg, 2) == ["M9,0 L10,0 L10,8 L9,8 Z"]


def test_stacked_layers_extend_under_upper_layers() -> None:
    layers = trace(_labels(), PALETTE, replace(POLYGON, stacking="stacked"))

    assert extract_paths(layers[0].raw_svg, 2) == ["M0,0 L10,0 L10,8 L0,8 Z"]
    assert extract_paths(layers[1].raw_svg, 2) == ["M6,0 L10,0 L10,8 L6,8 Z"]


def test_transparent_pixels_are_never_traced() -> None:
    labels = _labels()
    labels[:, :6] = TRANSPARENT_LABEL

    layers = trace(labels, PALETTE, replace(POLYGON, stacking="stacked"))

    assert [layer.palette_index for layer in layers] == [1, 2]
    assert extract_paths(layers[0].raw_svg, 2) == ["M6,0 L10,0 L10,8 L6,8 Z"]


def test_merged_palette_entries_form_one_region() -> None:
    palette = np.array([[255, 0, 0], [255, 0, 0], [0, 0, 255]], dtype=np.uint8)

    layers = trace(_labels(), palette, POLYGON)

    assert [layer.palette_index for layer in layers] == [0, 2]
    assert extract_paths(layers[0].raw_svg, 2) == ["M0,0 L9,0 L9,8 L0,8 Z"]


def test_spline_mode_keeps_small_regions() -> None:
    # vtracer's color mode would merge a 1 px stripe into its neighbour.
    layers = trace(_labels(), PALETTE, TracingOptions(mode="spline", filter_speckle=0))

    assert [layer.palette_index for layer in layers] == [0, 1, 2]
