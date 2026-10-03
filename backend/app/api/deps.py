from fastapi import UploadFile

from app.core.config import Settings
from app.core.errors import FileTooLarge, InvalidParameters


async def read_upload(file: UploadFile, settings: Settings) -> bytes:
    """Read an uploaded file enforcing the configured byte limit."""
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise FileTooLarge(
            f"File exceeds the limit of {settings.max_upload_mb} MB.",
            {"max_upload_mb": settings.max_upload_mb},
        )
    return data


def check_color_count(colors: int, settings: Settings) -> None:
    if not settings.min_colors <= colors <= settings.max_colors:
        raise InvalidParameters(
            f"`colors` must be between {settings.min_colors} and {settings.max_colors}.",
            {"min_colors": settings.min_colors, "max_colors": settings.max_colors},
        )
