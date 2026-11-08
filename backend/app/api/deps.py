import zlib
from typing import Literal

from fastapi import UploadFile
from fastapi.concurrency import run_in_threadpool

from app.core.config import Settings
from app.core.errors import FileTooLarge, InvalidParameters, InvalidSvg

# What every gzip file starts with: an .svgz, as Inkscape and Illustrator save it.
GZIP_MAGIC = b"\x1f\x8b"


async def read_upload(file: UploadFile, settings: Settings) -> bytes:
    """Read an uploaded file enforcing the configured byte limit."""
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise FileTooLarge(
            f"File exceeds the limit of {settings.max_upload_mb} MB.",
            {"max_upload_mb": settings.max_upload_mb},
        )
    return data


async def read_svg_upload(file: UploadFile, settings: Settings) -> bytes:
    """Read an uploaded SVG, also a gzip-compressed one (`.svgz`), unpacked in the thread
    pool. Within the upload limit as sent and as unpacked: a few kilobytes of gzip can
    unpack to gigabytes."""
    data = await read_upload(file, settings)
    if not data.startswith(GZIP_MAGIC):
        return data
    return await run_in_threadpool(gunzip_svg, data, settings)


def gunzip_svg(data: bytes, settings: Settings) -> bytes:
    """An `.svgz` unpacked; `FileTooLarge` past `max_upload_mb`, `InvalidSvg` when it is
    not whole gzip."""
    inflater = zlib.decompressobj(wbits=16 + zlib.MAX_WBITS)  # 16: a gzip header
    try:
        svg = inflater.decompress(data, settings.max_upload_bytes + 1)
    except zlib.error as exc:
        raise InvalidSvg("The SVG is gzip-compressed (.svgz) but cannot be unpacked.") from exc
    if len(svg) > settings.max_upload_bytes:
        raise FileTooLarge(
            f"The unpacked SVG exceeds the limit of {settings.max_upload_mb} MB.",
            {"max_upload_mb": settings.max_upload_mb},
        )
    if not inflater.eof:
        raise InvalidSvg("The gzip-compressed SVG (.svgz) is cut short.")
    return svg


def check_color_count(colors: int | Literal["auto"], settings: Settings) -> None:
    if isinstance(colors, int) and not settings.min_colors <= colors <= settings.max_colors:
        raise InvalidParameters(
            f"`colors` must be between {settings.min_colors} and {settings.max_colors}.",
            {"min_colors": settings.min_colors, "max_colors": settings.max_colors},
        )
