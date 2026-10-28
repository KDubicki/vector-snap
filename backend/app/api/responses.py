"""Responses the routes share."""

from fastapi import Response


def attachment(content: bytes, media_type: str, extension: str) -> Response:
    """A file to download, named `vectorsnap.<extension>`."""
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="vectorsnap.{extension}"'},
    )
