"""Helpers building small synthetic images for tests."""

import io

import numpy as np
from PIL import Image

RED = (255, 0, 0)
GREEN = (0, 160, 0)
BLUE = (0, 0, 255)


def encode(image: Image.Image, image_format: str = "PNG", **params: object) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=image_format, **params)
    return buffer.getvalue()


def stripes(
    colors: tuple[tuple[int, int, int], ...] = (RED, GREEN, BLUE),
    widths: tuple[int, ...] = (6, 3, 1),
    height: int = 4,
) -> Image.Image:
    """Vertical stripes; stripe widths define coverage order."""
    columns = [
        np.tile(np.array(c, dtype=np.uint8), (height, w, 1))
        for c, w in zip(colors, widths, strict=True)
    ]
    return Image.fromarray(np.concatenate(columns, axis=1), mode="RGB")


def with_transparent_corner(image: Image.Image, size: int = 2) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = np.array(rgba)
    pixels[:size, :size, 3] = 0
    return Image.fromarray(pixels, mode="RGBA")


def noisy(seed: int = 0) -> Image.Image:
    """Four color blocks with per-pixel noise, so there are many unique colors."""
    rng = np.random.default_rng(seed)
    base = np.zeros((32, 32, 3), dtype=np.int16)
    base[:16, :16] = (200, 30, 30)
    base[:16, 16:] = (30, 200, 30)
    base[16:, :16] = (30, 30, 200)
    base[16:, 16:] = (230, 230, 30)
    noise = rng.integers(-12, 13, size=base.shape)
    return Image.fromarray(np.clip(base + noise, 0, 255).astype(np.uint8), mode="RGB")


def gradient(size: int = 96) -> Image.Image:
    """Smooth two-axis gradient: no small palette represents it well."""
    x = np.linspace(0.0, 1.0, size)
    u, v = np.meshgrid(x, x)
    rgb = np.dstack([u * 255, v * 255, (1 - u) * 200])
    return Image.fromarray(rgb.astype(np.uint8), mode="RGB")
