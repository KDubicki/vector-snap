import io
import zlib

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
from tests.icc import gray_profile, rgb_profile
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
        decode_image(encode(Image.new("RGB", (4, 4)), "PPM"), max_dimension=64)


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


def _indexed(labels: list[list[int]], palette: list[int]) -> Image.Image:
    image = Image.fromarray(np.array(labels, dtype=np.uint8), mode="P")
    image.putpalette(palette)
    return image


def test_decode_indexed_keeps_partial_alpha_per_entry() -> None:
    image = _indexed([[0, 1, 2]], [255, 0, 0, 0, 255, 0, 0, 0, 255])

    decoded = decode_indexed_png(encode(image, transparency=bytes([255, 100, 0])), max_dimension=64)

    # 100 is below the opacity threshold: transparent like 0
    assert decoded.labels.tolist() == [[0, TRANSPARENT_LABEL, TRANSPARENT_LABEL]]


def test_decode_indexed_rejects_fully_transparent_images() -> None:
    image = _indexed([[0, 0]], [255, 0, 0])

    with pytest.raises(InvalidImage, match="no opaque pixels"):
        decode_indexed_png(encode(image, transparency=0), max_dimension=64)


def test_decode_indexed_rejects_too_many_colors() -> None:
    labels = np.arange(256, dtype=np.uint8).reshape(16, 16).tolist()
    palette = [value for i in range(256) for value in (i, 255 - i, i // 2)]

    with pytest.raises(InvalidImage, match="more than 254 colors"):
        decode_indexed_png(encode(_indexed(labels, palette)), max_dimension=64)


def test_decode_indexed_rejects_labels_outside_the_palette() -> None:
    image = _indexed([[0, 1, 2]], [255, 0, 0, 0, 255, 0, 0, 0, 255])
    data = bytearray(encode(image))
    # Shrink the PLTE chunk to its first entry, with a matching CRC.
    start = data.index(b"PLTE") - 4
    length = int.from_bytes(data[start : start + 4], "big")
    chunk = b"PLTE" + bytes(data[start + 8 : start + 11])
    data[start : start + 12 + length] = (
        (3).to_bytes(4, "big") + chunk + zlib.crc32(chunk).to_bytes(4, "big")
    )

    with pytest.raises(InvalidImage):
        decode_indexed_png(bytes(data), max_dimension=64)


def test_decodes_lossless_webp_exactly() -> None:
    image = stripes()

    decoded = decode_image(encode(image, "WEBP", lossless=True), max_dimension=64)

    assert np.array_equal(decoded.rgb, np.asarray(image))
    assert decoded.alpha_mask.all()


def test_webp_transparency_is_masked_out() -> None:
    data = encode(with_transparent_corner(stripes()), "WEBP", lossless=True)

    decoded = decode_image(data, max_dimension=64)

    assert not decoded.alpha_mask[0, 0]
    assert decoded.alpha_mask[-1, -1]


def test_decodes_avif() -> None:
    image = Image.new("RGB", (32, 16), (200, 30, 40))

    decoded = decode_image(encode(image, "AVIF", quality=90), max_dimension=64)

    assert (decoded.width, decoded.height) == (32, 16)
    # Lossy: close to the color, not exactly it.
    assert np.abs(decoded.rgb.astype(int) - (200, 30, 40)).max() <= 8


def test_an_animated_webp_is_read_as_its_first_frame() -> None:
    frames = [Image.new("RGB", (8, 8), color) for color in ((255, 0, 0), (0, 0, 255))]
    buffer = io.BytesIO()
    frames[0].save(buffer, "WEBP", save_all=True, append_images=frames[1:], lossless=True)

    decoded = decode_image(buffer.getvalue(), max_dimension=64)

    assert tuple(decoded.rgb[0, 0]) == (255, 0, 0)


def _paletted(labels: list[list[int]], colors: list[tuple[int, int, int]]) -> Image.Image:
    image = Image.fromarray(np.array(labels, dtype=np.uint8), mode="P")
    image.putpalette([value for color in colors for value in color])
    return image


def test_decodes_a_gif_and_its_transparent_color() -> None:
    image = _paletted([[0, 1, 2], [2, 1, 0]], [RED, (0, 0, 255), (0, 0, 0)])

    decoded = decode_image(encode(image, "GIF", transparency=2), max_dimension=64)

    assert decoded.rgb[0, :2].tolist() == [[255, 0, 0], [0, 0, 255]]
    assert decoded.alpha_mask.tolist() == [[True, True, False], [False, True, True]]


def test_a_gif_is_read_as_an_indexed_image() -> None:
    image = _paletted([[0, 1, 2], [2, 1, 0]], [RED, (0, 0, 255), (0, 0, 0)])

    indexed = decode_indexed_png(encode(image, "GIF", transparency=2), max_dimension=64)

    assert indexed.labels.tolist() == [[0, 1, TRANSPARENT_LABEL], [TRANSPARENT_LABEL, 1, 0]]
    assert indexed.palette.tolist() == [[255, 0, 0], [0, 0, 255]]


@pytest.mark.parametrize(
    ("image_format", "params"),
    [
        ("BMP", {}),
        ("TIFF", {}),
        ("TIFF", {"compression": "tiff_lzw"}),
        ("TIFF", {"compression": "tiff_adobe_deflate"}),
    ],
)
def test_decodes_bmp_and_tiff_exactly(image_format: str, params: dict[str, object]) -> None:
    decoded = decode_image(encode(stripes(), image_format, **params), max_dimension=64)

    assert decoded.rgb[0, [0, 6, 9]].tolist() == [[255, 0, 0], [0, 160, 0], [0, 0, 255]]


def test_a_tiff_with_several_pages_is_read_as_its_first_page() -> None:
    pages = [Image.new("RGB", (8, 8), color) for color in (RED, (0, 0, 255))]
    buffer = io.BytesIO()
    pages[0].save(buffer, "TIFF", save_all=True, append_images=pages[1:])

    assert tuple(decode_image(buffer.getvalue(), max_dimension=64).rgb[0, 0]) == RED


def test_decodes_a_16_bit_grayscale_tiff() -> None:
    image = Image.fromarray(np.array([[0, 32768, 65535]], dtype=np.uint16))

    decoded = decode_image(encode(image, "TIFF"), max_dimension=64)

    assert decoded.rgb[0, :, 0].tolist() == [0, 128, 255]


def test_refuses_a_tiff_of_floating_point_values() -> None:
    image = Image.fromarray(np.full((4, 4), 0.5, dtype=np.float32))

    with pytest.raises(InvalidImage, match="floating point"):
        decode_image(encode(image, "TIFF"), max_dimension=64)


def test_the_webp_size_limit_holds() -> None:
    with pytest.raises(ImageTooLarge):
        decode_image(encode(Image.new("RGB", (100, 10)), "WEBP"), max_dimension=64)


def _gray16(transparency: int | None = None) -> bytes:
    """A 16-bit grayscale PNG: black, mid gray (0x8000) and white, left to right."""
    values = np.array([[0, 0x8000, 0xFFFF]] * 2, dtype=np.uint16)
    image = Image.fromarray(values)
    if transparency is None:
        return encode(image)
    return encode(image, "PNG", transparency=transparency)


def test_decodes_16_bit_grayscale_pngs() -> None:
    decoded = decode_image(_gray16(), max_dimension=64)

    # Scaled to 8 bits, not clipped at 255 (which made every pixel but black white).
    assert [tuple(pixel) for pixel in decoded.rgb[0]] == [(0, 0, 0), (128, 128, 128), (255,) * 3]
    assert decoded.alpha_mask.all()


def test_a_16_bit_grayscale_png_keeps_its_transparent_gray() -> None:
    decoded = decode_image(_gray16(transparency=0xFFFF), max_dimension=64)

    assert decoded.alpha_mask[0].tolist() == [True, True, False]
    assert tuple(decoded.rgb[0, 1]) == (128, 128, 128)


# A color profile whose values are linear light: 128 is sRGB's 188 (50% light).
LINEAR = rgb_profile("Linear RGB", gamma=1.0)


def _gray_and_red(icc: bytes, image_format: str = "PNG", mode: str = "RGB") -> bytes:
    image = Image.new(mode, (2, 1), (128, 128, 128))
    image.putpixel((1, 0), (255, 0, 0, 0) if mode == "RGBA" else (255, 0, 0))
    return encode(image, image_format, icc_profile=icc)


@pytest.mark.parametrize("image_format", ["PNG", "JPEG", "WEBP"])
def test_converts_colors_of_another_profile_to_srgb(image_format: str) -> None:
    params = {"quality": 100} if image_format == "JPEG" else {"lossless": True}
    image = Image.new("RGB", (8, 8), (128, 128, 128))

    decoded = decode_image(
        encode(image, image_format, icc_profile=LINEAR, **params), max_dimension=64
    )

    assert np.abs(decoded.rgb.astype(int) - 188).max() <= 1


def test_converting_keeps_transparency() -> None:
    decoded = decode_image(_gray_and_red(LINEAR, mode="RGBA"), max_dimension=64)

    assert decoded.alpha_mask.tolist() == [[True, False]]
    assert np.abs(decoded.rgb[0, 0].astype(int) - 188).max() <= 1


def test_converts_a_gray_profile() -> None:
    data = encode(Image.new("L", (2, 2), 128), icc_profile=gray_profile("Gray linear"))

    decoded = decode_image(data, max_dimension=64)

    assert np.abs(decoded.rgb.astype(int) - 188).max() <= 1


@pytest.mark.parametrize(
    "icc",
    [
        rgb_profile("sRGB IEC61966-2.1", gamma=1.0),  # named sRGB: values kept exactly
        b"not a color profile",
    ],
)
def test_keeps_the_values_of_srgb_and_unreadable_profiles(icc: bytes) -> None:
    decoded = decode_image(_gray_and_red(icc), max_dimension=64)

    assert decoded.rgb.tolist() == [[[128, 128, 128], [255, 0, 0]]]


def test_a_16_bit_grayscale_png_keeps_its_profile() -> None:
    values = np.full((2, 2), 0x8000, dtype=np.uint16)
    data = encode(Image.fromarray(values), "PNG", icc_profile=gray_profile("Gray linear"))

    decoded = decode_image(data, max_dimension=64)

    assert np.abs(decoded.rgb.astype(int) - 188).max() <= 1
