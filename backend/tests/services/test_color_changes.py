import pytest

from app.core.errors import InvalidParameters
from app.services.color_changes import (
    ChangeCosts,
    FilamentUse,
    count_changes,
    estimate_color_changes,
)
from app.services.export_stl import StlOptions
from app.services.svg_geometry import parse_svg
from tests.vectors import contract_svg

LEFT = "M0,0 L20,0 L20,20 L0,20 Z"
RIGHT = "M20,0 L40,0 L40,20 L20,20 Z"
SVG = parse_svg(contract_svg(40, 20, [("#ff0000", [LEFT]), ("#0000ff", [RIGHT])]))


def test_counts_like_the_slicer_orders_the_layers() -> None:
    # Anycubic Slicer Next (Kobra X profile) on the same layers: 10 and 15 changes.
    assert count_changes([["a", "b"]] * 10) == 10
    assert count_changes([["a", "b", "c", "d"]] * 5) == 15
    # A layer starts with the filament the previous one ended with ...
    assert count_changes([["a"], ["a", "b"], ["b"]]) == 1
    # ... and ends with one the next layer needs.
    assert count_changes([["a", "b", "c"], ["c"], ["c", "a"]]) == 3
    assert count_changes([["a"], [], ["b"]]) == 1
    assert count_changes([]) == 0


def test_flat_colors_change_filament_on_every_layer() -> None:
    options = StlOptions(width_mm=40, base_mm=0, layer_mm=2, layered=False, print_layer_mm=0.2)

    estimate = estimate_color_changes(SVG, options, ChangeCosts(change_s=49, purge_mm3=226))

    assert (estimate.layers, estimate.changes, estimate.max_colors_per_layer) == (10, 10, 2)
    assert estimate.change_time_s == 490
    assert estimate.purge_mm3 == 2260
    assert estimate.purge_g == pytest.approx(2.8, abs=0.01)  # PLA, 1.24 g/cm³


def test_stepped_colors_change_only_where_colors_share_layers() -> None:
    # Base (red, the bottom color) 0-1 mm; red to 1.4 mm and blue to 1.8 mm stand on it,
    # so two layers have both colors. Anycubic Slicer Next: 3 changes as well.
    options = StlOptions(width_mm=40, base_mm=1, layer_mm=0.4, print_layer_mm=0.2)

    estimate = estimate_color_changes(SVG, options)

    assert (estimate.layers, estimate.changes, estimate.max_colors_per_layer) == (9, 3, 2)
    assert (estimate.change_time_s, estimate.purge_g) == (0, 0)


def test_needs_the_printer_layer_height() -> None:
    with pytest.raises(InvalidParameters, match="print_layer_mm"):
        estimate_color_changes(SVG, StlOptions())


def test_reports_the_filament_each_color_takes() -> None:
    # Base (red, the bottom color) 40 x 20 x 1 mm; red and blue squares 20 x 20 x 0.4 and 0.8.
    options = StlOptions(width_mm=40, base_mm=1, layer_mm=0.4, print_layer_mm=0.2)

    estimate = estimate_color_changes(SVG, options, ChangeCosts(density_g_cm3=1.25))

    assert estimate.filaments == [
        FilamentUse(color="#ff0000", volume_mm3=800 + 160, grams=1.2),
        FilamentUse(color="#0000ff", volume_mm3=320, grams=0.4),
    ]
