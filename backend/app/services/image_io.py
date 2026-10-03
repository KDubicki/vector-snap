"""Decoding, validation and encoding of raster images.

See docs/06-image-processing-pipeline.md, sections 1-2.
"""

import io
import warnings
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.errors import ImageTooLarge, InvalidImage, NotIndexedImage, UnsupportedMediaType

SUPPORTED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png"}

# Pixels with alpha below this threshold are treated as fully transparent.
ALPHA_THRESHOLD = 128

# Label used for transparent pixels in label maps (palettes are limited to 255 entries).
TRANSPARENT_LABEL = 255


@dataclass(frozen=True)
class DecodedImage:
    rgb: NDArray[np.uint8]  # H x W x 3
    alpha_mask: NDArray[np.bool_]  # H x W, True = opaque
    width: int
    height: int
    is_indexed: bool

    @property
    def has_transparency(self) -> bool:
        return not bool(self.alpha_mask.all())


@dataclass(frozen=True)
class IndexedImage:
    """Label map read back from a palette-mode PNG (e.g. one produced by `/quantize`)."""

    labels: NDArray[np.uint8]  # H x W palette indices, TRANSPARENT_LABEL for transparent pixels
    palette: NDArray[np.uint8]  # N x 3 opaque palette entries


def _open(data: bytes, max_dimension: int) -> Image.Image:
    # Decompression-bomb guard: Pillow raises once an image exceeds 2x this pixel count.
    Image.MAX_IMAGE_PIXELS = max_dimension * max_dimension
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(data))
            image_format = image.format
            if image_format not in SUPPORTED_FORMATS:
                raise UnsupportedMediaType(
                    f"Unsupported image format: {image_format or 'unknown'}.",
                    {"supported_formats": list(SUPPORTED_FORMATS.values())},
                )
            if max(image.size) > max_dimension:
                raise ImageTooLarge(
                    f"Image dimensions {image.width}x{image.height} exceed the limit of "
                    f"{max_dimension} px.",
                    {"max_dimension": max_dimension},
                )
            image.load()
    except UnidentifiedImageError as exc:
        raise UnsupportedMediaType(
            "File is not a supported image.",
            {"supported_formats": list(SUPPORTED_FORMATS.values())},
        ) from exc
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ImageTooLarge("Image has too many pixels.", {"max_dimension": max_dimension}) from exc
    except OSError as exc:
        raise InvalidImage("Image file is corrupt or truncated.") from exc
    return image


def decode_image(data: bytes, max_dimension: int) -> DecodedImage:
    """Validate and normalize uploaded bytes into an RGB array and alpha mask."""
    image = _open(data, max_dimension)
    is_indexed = image.mode == "P"
    rgba = ImageOps.exif_transpose(image).convert("RGBA")

    pixels = np.asarray(rgba, dtype=np.uint8)
    alpha = pixels[..., 3]
    alpha_mask = alpha >= ALPHA_THRESHOLD
    if not alpha_mask.any():
        raise InvalidImage("Image has no opaque pixels.")

    # Composite semi-transparent pixels over white for color computation.
    alpha_f = alpha[..., None].astype(np.float32) / 255.0
    rgb = pixels[..., :3].astype(np.float32) * alpha_f + 255.0 * (1.0 - alpha_f)

    return DecodedImage(
        rgb=np.rint(rgb).astype(np.uint8),
        alpha_mask=alpha_mask,
        width=rgba.width,
        height=rgba.height,
        is_indexed=is_indexed,
    )


def decode_indexed_png(data: bytes, max_dimension: int) -> IndexedImage:
    """Read the label map and opaque palette from a palette-mode PNG.

    Transparent palette entries (single `tRNS` index or per-entry alpha) are removed from
    the palette and their pixels relabelled as TRANSPARENT_LABEL.
    """
    image = _open(data, max_dimension)
    if image.mode != "P":
        raise NotIndexedImage("Image is not an indexed (palette-mode) PNG.")

    raw_labels = np.asarray(image, dtype=np.uint8)
    used = int(raw_labels.max()) + 1
    palette = np.asarray(image.getpalette() or [], dtype=np.uint8).reshape(-1, 3)
    if len(palette) < used:
        raise InvalidImage("Indexed PNG references colors missing from its palette.")
    palette = palette[:used]

    transparency = image.info.get("transparency")
    alphas = np.full(used, 255, dtype=np.uint8)
    if isinstance(transparency, int) and transparency < used:
        alphas[transparency] = 0
    elif isinstance(transparency, bytes):
        values = np.frombuffer(transparency, dtype=np.uint8)[:used]
        alphas[: len(values)] = values

    opaque = np.flatnonzero(alphas >= ALPHA_THRESHOLD)
    if len(opaque) == 0:
        raise InvalidImage("Image has no opaque pixels.")
    if len(opaque) >= TRANSPARENT_LABEL:
        raise InvalidImage(f"Indexed PNG has more than {TRANSPARENT_LABEL - 1} colors.")

    lookup = np.full(256, TRANSPARENT_LABEL, dtype=np.uint8)
    lookup[opaque] = np.arange(len(opaque), dtype=np.uint8)
    return IndexedImage(labels=lookup[raw_labels], palette=palette[opaque])


def encode_indexed_png(
    labels: NDArray[np.uint8], palette: NDArray[np.uint8], transparent_index: int | None
) -> bytes:
    """Encode a label map and palette as a palette-mode PNG.

    When `transparent_index` is set it must equal `len(palette)`; a placeholder entry is
    appended for it and declared transparent via the PNG `tRNS` chunk.
    """
    entries = palette
    if transparent_index is not None:
        entries = np.vstack([palette, np.zeros((1, 3), dtype=np.uint8)])

    image = Image.fromarray(labels, mode="P")
    image.putpalette(entries.astype(np.uint8).flatten().tolist())

    buffer = io.BytesIO()
    if transparent_index is not None:
        image.save(buffer, format="PNG", optimize=False, transparency=transparent_index)
    else:
        image.save(buffer, format="PNG", optimize=False)
    return buffer.getvalue()
