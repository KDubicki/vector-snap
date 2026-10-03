import numpy as np
import pytest
from lxml import etree

from app.services.svg_postprocess import (
    ALLOWED_ELEMENTS,
    SVG_NS,
    build_svg,
    extract_paths,
    translate_path,
)
from app.services.vectorization import TracedLayer

PALETTE = np.array([[255, 0, 0], [0, 0, 255]], dtype=np.uint8)


def _raw(*paths: str) -> str:
    body = "".join(paths)
    return f'<svg xmlns="{SVG_NS}" width="10" height="10">{body}</svg>'


@pytest.mark.parametrize(
    ("d", "dx", "dy", "precision", "expected"),
    [
        ("M0,0 L16,0 L16,10 Z ", 4, 1, 2, "M4,1 L20,1 L20,11 Z"),
        ("M0 0 C1.5 -2.25 3 4 5 6 Z", 10, 20, 2, "M10 20 C11.5 17.75 13 24 15 26 Z"),
        ("M0,0 L1.234,5.678", 0, 0, 1, "M0,0 L1.2,5.7"),
        ("M-1,-1 L0.4,0", 1, 1, 0, "M0,0 L1,1"),
    ],
)
def test_translate_path(d: str, dx: float, dy: float, precision: int, expected: str) -> None:
    assert translate_path(d, dx, dy, precision) == expected


def test_extract_paths_bakes_transforms_and_skips_empty_paths() -> None:
    raw = _raw(
        '<path d="M0,0 L1,0 Z" transform="translate(5,6)"/>',
        '<path d=""/>',
        '<path d="M2,2 L3,3 Z"/>',
    )

    assert extract_paths(raw, 2) == ["M5,6 L6,6 Z", "M2,2 L3,3 Z"]


def test_extract_paths_does_not_resolve_entities() -> None:
    raw = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' + _raw(
        '<path d="M0,0 L1,1 Z"/><desc>&xxe;</desc>'
    )

    assert extract_paths(raw, 2) == ["M0,0 L1,1 Z"]


def test_build_svg_follows_output_contract() -> None:
    layers = [
        TracedLayer(0, _raw('<path d="M0,0 L1,0 Z"/>', '<path d="M5,5 L6,5 Z"/>')),
        TracedLayer(1, _raw('<path d="M2,2 L3,2 Z" transform="translate(1,1)"/>')),
    ]

    document = build_svg(layers, PALETTE, 10, 8, precision=2)
    root = etree.fromstring(document.svg.encode())

    assert document.path_count == 3
    assert root.get("viewBox") == "0 0 10 8"
    assert {etree.QName(e).localname for e in root.iter()} <= ALLOWED_ELEMENTS
    groups = root.findall(f"{{{SVG_NS}}}g")
    assert [(g.get("id"), g.get("fill")) for g in groups] == [
        ("color-0", "#ff0000"),
        ("color-1", "#0000ff"),
    ]
    paths = list(root.iter(f"{{{SVG_NS}}}path"))
    assert [p.get("id") for p in paths] == ["p-0-0", "p-0-1", "p-1-0"]
    assert paths[2].get("d") == "M3,3 L4,3 Z"
    assert all(p.get("transform") is None for p in paths)
