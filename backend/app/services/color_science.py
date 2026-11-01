"""Color science shared by quantization, palette clean-up and SVG color edits: sRGB to
CIE Lab, the CIEDE2000 color difference and nearest-color search.

See docs/06-image-processing-pipeline.md, section 3.
"""

import numpy as np
from numpy.typing import NDArray

# D65 reference white and sRGB -> XYZ matrix.
_WHITE_D65 = np.array([0.95047, 1.0, 1.08883])
_SRGB_TO_XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]
)


def srgb_to_lab(rgb: NDArray[np.uint8]) -> NDArray[np.float64]:
    """Convert N x 3 sRGB colors to CIE Lab (D65)."""
    c = rgb.astype(np.float64) / 255.0
    linear = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    xyz = (linear @ _SRGB_TO_XYZ.T) / _WHITE_D65
    delta = 6.0 / 29.0
    f = np.where(xyz > delta**3, np.cbrt(xyz), xyz / (3 * delta**2) + 4.0 / 29.0)
    lab: NDArray[np.float64] = np.empty(f.shape, dtype=np.float64)
    lab[:, 0] = 116.0 * f[:, 1] - 16.0
    lab[:, 1] = 500.0 * (f[:, 0] - f[:, 1])
    lab[:, 2] = 200.0 * (f[:, 1] - f[:, 2])
    return lab


def pack_rgb(rgb: NDArray[np.uint8]) -> NDArray[np.uint32]:
    c = rgb.astype(np.uint32)
    packed: NDArray[np.uint32] = np.asarray(
        (c[:, 0] << 16) | (c[:, 1] << 8) | c[:, 2], dtype=np.uint32
    )
    return packed


def unpack_rgb(packed: NDArray[np.uint32]) -> NDArray[np.uint8]:
    return np.stack([(packed >> 16) & 0xFF, (packed >> 8) & 0xFF, packed & 0xFF], axis=1).astype(
        np.uint8
    )


def nearest_center(
    points: NDArray[np.float64], centers: NDArray[np.float64], chunk: int = 65536
) -> NDArray[np.intp]:
    """Index of the nearest center for every point, computed in chunks to bound memory."""
    nearest = np.empty(len(points), dtype=np.intp)
    for start in range(0, len(points), chunk):
        block = points[start : start + chunk]
        distances = ((block[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        nearest[start : start + chunk] = distances.argmin(axis=1)
    return nearest


def lab_distances(points: NDArray[np.float64], centers: NDArray[np.float64]) -> NDArray[np.float64]:
    """ΔE (CIE76) from every point to every center, without an N x C x 3 temporary."""
    squared = (
        (points**2).sum(axis=1)[:, None]
        + (centers**2).sum(axis=1)[None, :]
        - 2 * points @ centers.T
    )
    distances: NDArray[np.float64] = np.sqrt(np.maximum(squared, 0))
    return distances


def delta_e_2000(lab1: NDArray[np.float64], lab2: NDArray[np.float64]) -> NDArray[np.float64]:
    """CIEDE2000 color difference between CIE Lab colors, element-wise (broadcasting).

    The perceptual scale of color differences (Sharma, Wu & Dalal 2005): unlike plain
    Lab distance (CIE76) it weighs lightness, chroma and hue as the eye does, so one
    limit means "hard to tell apart" for whites, grays and saturated colors alike. Below
    1 people cannot tell two colors apart, at 1-2 only side by side on a close look, at
    2-10 at a glance.
    """
    l1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    l2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    c_mean = (np.hypot(a1, b1) + np.hypot(a2, b2)) / 2
    g = 0.5 * (1 - np.sqrt(c_mean**7 / (c_mean**7 + 25.0**7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    dl = l2 - l1
    dc = c2p - c1p
    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh))
    dh = np.where(c1p * c2p == 0, 0.0, dh)
    dhh = 2 * np.sqrt(c1p * c2p) * np.sin(np.radians(dh / 2))
    l_mean = (l1 + l2) / 2
    cp_mean = (c1p + c2p) / 2
    h_sum = h1p + h2p
    h_mean = np.where(
        np.abs(h1p - h2p) <= 180,
        h_sum / 2,
        np.where(h_sum < 360, (h_sum + 360) / 2, (h_sum - 360) / 2),
    )
    h_mean = np.where(c1p * c2p == 0, h_sum, h_mean)
    t = (
        1
        - 0.17 * np.cos(np.radians(h_mean - 30))
        + 0.24 * np.cos(np.radians(2 * h_mean))
        + 0.32 * np.cos(np.radians(3 * h_mean + 6))
        - 0.20 * np.cos(np.radians(4 * h_mean - 63))
    )
    s_l = 1 + 0.015 * (l_mean - 50) ** 2 / np.sqrt(20 + (l_mean - 50) ** 2)
    s_c = 1 + 0.045 * cp_mean
    s_h = 1 + 0.015 * cp_mean * t
    r_t = (
        -2
        * np.sqrt(cp_mean**7 / (cp_mean**7 + 25.0**7))
        * np.sin(np.radians(60 * np.exp(-(((h_mean - 275) / 25) ** 2))))
    )
    result: NDArray[np.float64] = np.sqrt(
        (dl / s_l) ** 2 + (dc / s_c) ** 2 + (dhh / s_h) ** 2 + r_t * (dc / s_c) * (dhh / s_h)
    )
    return result
