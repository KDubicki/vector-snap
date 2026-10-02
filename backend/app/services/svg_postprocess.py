"""Sanitize and normalize raw tracer output to the VectorSnap SVG contract.

See docs/05-api-specification.md#svg-output-contract and
docs/06-image-processing-pipeline.md, section 6.
"""

ALLOWED_ELEMENTS = frozenset({"svg", "g", "path", "title", "desc"})


def postprocess_svg(raw_svg: str, palette_hex: list[str], width: int, height: int) -> str:
    """Group paths per palette color, assign ids/data attributes and strip unsafe content."""
    raise NotImplementedError
