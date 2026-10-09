import numpy as np
import pytest
from PIL import Image

from app.core.errors import ImageTooLarge, InvalidImage, UnsupportedMediaType
from app.services.image_io import (
    TRANSPARENT_LABEL,
    decode_image,
    decode_indexed_png,
    encode_indexed_png,
    upscale_factor,
)
from tests.images import RED, encode, stripes, with_transparent_corner


def test_decodes_png_to_rgb_and_opaque_mask() -> None:
    image = decode_image(encode(stripes()), max_dimension=64)

    assert (image.width, image.height) == (10, 4)
    assert image.rgb.shape == (4, 10, 3)
    assert tuple(image.rgb[0, 0]) == RED
    assert image.alpha_mask.all()
    assert not image.is_indexed
    assert not image.has_transparency


def test_transparent_pixels_are_masked_out() -> None:
    image = decode_image(encode(with_transparent_corner(stripes())), max_dimension=64)

    assert image.has_transparency
    assert not image.alpha_mask[:2, :2].any()
    assert image.alpha_mask[2:, :].all()


def test_semi_transparent_pixels_are_composited_over_white() -> None:
    pixels = np.zeros((2, 2, 4), dtype=np.uint8)
    pixels[...] = (0, 0, 0, 200)

    image = decode_image(encode(Image.fromarray(pixels, mode="RGBA")), max_dimension=64)

    assert tuple(image.rgb[0, 0]) == (55, 55, 55)


def test_applies_jpeg_exif_orientation() -> None:
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90 degrees clockwise when displaying
    data = encode(Image.new("RGB", (20, 10), RED), "JPEG", exif=exif)

    image = decode_image(data, max_dimension=64)

    assert (image.width, image.height) == (10, 20)


def test_rejects_unsupported_format() -> None:
    with pytest.raises(UnsupportedMediaType):
        decode_image(encode(Image.new("RGB", (4, 4)), "GIF"), max_dimension=64)


def test_rejects_non_image_bytes() -> None:
    with pytest.raises(UnsupportedMediaType):
        decode_image(b"definitely not an image", max_dimension=64)


def test_rejects_images_over_dimension_limit() -> None:
    with pytest.raises(ImageTooLarge):
        decode_image(encode(Image.new("RGB", (65, 10))), max_dimension=64)


def test_rejects_decompression_bombs() -> None:
    # 200x200 = 40 000 px > 2 * 100^2 triggers Pillow's bomb guard before our size check.
    with pytest.raises(ImageTooLarge):
        decode_image(encode(Image.new("RGB", (200, 200))), max_dimension=100)


def test_rejects_truncated_files() -> None:
    data = encode(stripes(height=64))

    with pytest.raises(InvalidImage):
        decode_image(data[: len(data) // 2], max_dimension=64)


def test_rejects_fully_transparent_images() -> None:
    with pytest.raises(InvalidImage, match="no opaque pixels"):
        decode_image(encode(Image.new("RGBA", (4, 4), (0, 0, 0, 0))), max_dimension=64)


def test_indexed_png_round_trip_with_transparency() -> None:
    labels = np.array([[0, 1], [2, 2]], dtype=np.uint8)
    palette = np.array([[255, 0, 0], [0, 255, 0]], dtype=np.uint8)

    data = encode_indexed_png(labels, palette, transparent_index=2)
    decoded = decode_indexed_png(data, max_dimension=64)
    image = decode_image(data, max_dimension=64)

    assert decoded.labels.tolist() == [[0, 1], [TRANSPARENT_LABEL, TRANSPARENT_LABEL]]
    assert np.array_equal(decoded.palette, palette)
    assert image.is_indexed
    assert not image.alpha_mask[1].any()


def test_indexed_png_round_trip_without_transparency() -> None:
    labels = np.array([[0, 1]], dtype=np.uint8)
    palette = np.array([[1, 2, 3], [4, 5, 6]], dtype=np.uint8)

    decoded = decode_indexed_png(encode_indexed_png(labels, palette, None), max_dimension=64)

    assert np.array_equal(decoded.palette, palette)
    assert TRANSPARENT_LABEL not in decoded.labels


def test_decode_indexed_rejects_rgb_png() -> None:
    with pytest.raises(InvalidImage, match="indexed"):
        decode_indexed_png(encode(stripes()), max_dimension=64)


def test_decode_indexed_relabels_transparent_entry_in_the_middle() -> None:
    image = Image.fromarray(np.array([[0, 1, 2]], dtype=np.uint8), mode="P")
    image.putpalette([255, 0, 0, 0, 0, 0, 0, 0, 255])

    decoded = decode_indexed_png(encode(image, transparency=1), max_dimension=64)

    assert decoded.labels.tolist() == [[0, TRANSPARENT_LABEL, 1]]
    assert decoded.palette.tolist() == [[255, 0, 0], [0, 0, 255]]


def test_decode_indexed_supports_per_entry_alpha() -> None:
    image = Image.fromarray(np.array([[0, 1]], dtype=np.uint8), mode="P")
    image.putpalette([255, 0, 0, 0, 255, 0])

    decoded = decode_indexed_png(encode(image, transparency=bytes([0, 255])), max_dimension=64)

    assert decoded.labels.tolist() == [[TRANSPARENT_LABEL, 0]]
    assert decoded.palette.tolist() == [[0, 255, 0]]


@pytest.mark.parametrize(
    ("size", "max_dimension", "factor"),
    [
        ((100, 50), 4096, 4),
        ((300, 200), 4096, 4),
        ((400, 100), 4096, 3),
        ((600, 600), 4096, 2),
        ((1024, 10), 4096, 1),
        ((2000, 3000), 4096, 1),
        ((300, 300), 700, 2),
    ],
)
def test_upscale_factor(size: tuple[int, int], max_dimension: int, factor: int) -> None:
    assert upscale_factor(*size, max_dimension) == factor


def test_upscale_enlarges_small_images_with_smooth_edges() -> None:
    image = Image.new("RGBA", (40, 20), (0, 0, 0, 0))
    image.paste((255, 0, 0, 255), (10, 0, 30, 20))
    decoded = decode_image(encode(image), 4096, upscale=True)

    assert (decoded.width, decoded.height) == (160, 80)
    assert decoded.rgb.shape == (80, 160, 3)
    # the opaque area scales with the image; edges are not darkened by the transparent black
    assert decoded.alpha_mask.sum() == pytest.approx(80 * 80, rel=0.05)
    assert (decoded.rgb[decoded.alpha_mask][:, 0] > 240).all()


def test_upscale_is_off_by_default_and_skips_large_images() -> None:
    small = encode(stripes())
    large = encode(Image.new("RGB", (1200, 10), RED))

    assert decode_image(small, 4096).width == stripes().width
    assert decode_image(large, 4096, upscale=True).width == 1200
