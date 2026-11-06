"""Minimal ICC v2 display profiles for tests: Pillow can only create sRGB, Lab and XYZ
profiles, so an image "in another color space" needs one written by hand."""

import struct

# sRGB's primaries adapted to the D50 profile connection space (as in sRGB IEC61966-2.1).
SRGB_PRIMARIES = (
    (0.4360747, 0.2225045, 0.0139322),
    (0.3850649, 0.7168786, 0.0971045),
    (0.1430804, 0.0606169, 0.7141733),
)
D50 = (0.9642, 1.0, 0.8249)


def _s15f16(value: float) -> bytes:
    return struct.pack(">i", round(value * 65536))


def _xyz(xyz: tuple[float, float, float]) -> bytes:
    return b"XYZ \0\0\0\0" + b"".join(_s15f16(v) for v in xyz)


def _curve(gamma: float) -> bytes:
    return b"curv\0\0\0\0" + struct.pack(">IH", 1, round(gamma * 256)) + b"\0\0"


def _desc(text: str) -> bytes:
    ascii_text = text.encode("ascii") + b"\0"
    return (
        b"desc\0\0\0\0"
        + struct.pack(">I", len(ascii_text))
        + ascii_text
        + struct.pack(">II", 0, 0)  # no Unicode description
        + struct.pack(">HB", 0, 0)  # no ScriptCode description
        + b"\0" * 67
    )


def _profile(color_space: bytes, tags: list[tuple[bytes, bytes]]) -> bytes:
    table_size = 4 + 12 * len(tags)
    offset = 128 + table_size
    entries, data = [], b""
    for signature, body in tags:
        body += b"\0" * (-len(body) % 4)
        entries.append(struct.pack(">4sII", signature, offset + len(data), len(body)))
        data += body
    size = offset + len(data)
    header = (
        struct.pack(">I", size)
        + b"\0\0\0\0"
        + struct.pack(">I", 0x02100000)
        + b"mntr"
        + color_space
        + b"XYZ "
        + struct.pack(">6H", 2026, 1, 1, 0, 0, 0)
        + b"acsp"
        + b"\0" * 24  # platform, flags, manufacturer, model, attributes
        + struct.pack(">I", 0)  # perceptual intent
        + b"".join(_s15f16(v) for v in D50)
        + b"\0" * 48  # creator, profile id, reserved
    )
    assert len(header) == 128
    return header + struct.pack(">I", len(tags)) + b"".join(entries) + data


def rgb_profile(
    description: str,
    gamma: float = 1.0,
    primaries: tuple[tuple[float, float, float], ...] = SRGB_PRIMARIES,
) -> bytes:
    """An RGB display profile with one gamma for every channel (1.0 = linear light)."""
    red, green, blue = primaries
    return _profile(
        b"RGB ",
        [
            (b"desc", _desc(description)),
            (b"wtpt", _xyz(D50)),
            (b"rXYZ", _xyz(red)),
            (b"gXYZ", _xyz(green)),
            (b"bXYZ", _xyz(blue)),
            (b"rTRC", _curve(gamma)),
            (b"gTRC", _curve(gamma)),
            (b"bTRC", _curve(gamma)),
        ],
    )


def gray_profile(description: str, gamma: float = 1.0) -> bytes:
    return _profile(
        b"GRAY", [(b"desc", _desc(description)), (b"wtpt", _xyz(D50)), (b"kTRC", _curve(gamma))]
    )
