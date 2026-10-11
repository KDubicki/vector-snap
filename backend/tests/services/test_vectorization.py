from dataclasses import replace

import numpy as np
from shapely import contains_xy, unary_union

from app.services.image_io import TRANSPARENT_LABEL
from app.services.svg_geometry import layer_geometries, parse_svg
from app.services.svg_postprocess import build_svg, extract_paths
from app.services.vectorization import TracingOptions, absorb_specks, color_layers, trace

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


def test_cutout_traces_each_color_overlapping_the_one_below_by_a_pixel() -> None:
    layers = trace(_labels(), PALETTE, POLYGON)

    assert [layer.palette_index for layer in layers] == [0, 1, 2]
    assert extract_paths(layers[0].raw_svg, 2) == ["M0,0 L6,0 L6,8 L0,8 Z"]
    assert extract_paths(layers[1].raw_svg, 2) == ["M5,0 L9,0 L9,8 L5,8 Z"]
    assert extract_paths(layers[2].raw_svg, 2) == ["M8,0 L10,0 L10,8 L8,8 Z"]


def test_cutout_layers_never_grow_into_transparent_pixels() -> None:
    labels = _labels()
    labels[:, :6] = TRANSPARENT_LABEL

    layers = trace(labels, PALETTE, POLYGON)

    assert extract_paths(layers[0].raw_svg, 2) == ["M6,0 L9,0 L9,8 L6,8 Z"]


def test_specks_take_the_color_around_them_instead_of_leaving_holes() -> None:
    labels = np.zeros((12, 12), dtype=np.uint8)
    labels[5:7, 5:7] = 1  # 4 px: below vtracer's 4 x 4 speckle filter

    layers = trace(labels, PALETTE[:2], TracingOptions(mode="polygon", filter_speckle=4))

    assert [layer.palette_index for layer in layers] == [0, 1]
    assert extract_paths(layers[0].raw_svg, 2) == ["M0,0 L12,0 L12,12 L0,12 Z"]
    assert extract_paths(layers[1].raw_svg, 2) == []


def test_absorb_specks_keeps_specks_alone_in_transparent_areas() -> None:
    ranks = np.full((6, 6), 2, dtype=np.int64)
    ranks[2, 2] = 0
    opaque = ranks != 2

    assert (absorb_specks(ranks, opaque, 4) == ranks).all()


def test_absorb_specks_is_off_without_a_speckle_filter() -> None:
    ranks = np.zeros((6, 6), dtype=np.int64)
    ranks[2, 2] = 1

    assert (absorb_specks(ranks, np.ones((6, 6), dtype=np.bool_), 1) == ranks).all()


def test_spline_tracing_leaves_no_gaps_between_colors() -> None:
    # Two colors meeting along a diagonal edge, smoothed independently by spline mode.
    y, x = np.mgrid[:40, :40]
    labels = np.where(x + 0.6 * y > 30, 1, 0).astype(np.uint8)
    labels[(x - 30) ** 2 + (y - 10) ** 2 < 30] = 2
    width = labels.shape[1]
    document = build_svg(
        trace(labels, PALETTE, TracingOptions()), PALETTE, width, width, precision=2
    )
    union = unary_union(layer_geometries(parse_svg(document.svg.encode())))

    ys, xs = np.mgrid[:40, :40] + 0.5
    assert contains_xy(union, xs.ravel(), ys.ravel()).all()


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
