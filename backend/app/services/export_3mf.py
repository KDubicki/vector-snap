"""Export a vector document as 3MF for multi-color / multi-material 3D printing.

The bodies of the STL export (base plate and one per color) become separate 3MF objects
with their color, combined into one assembly: slicers import them as parts of a single
model that stay aligned and can each get their own filament (AMS, MMU, tool changers).
Slicers of the Orca / Bambu Studio family (Anycubic Slicer Next, OrcaSlicer, Bambu Studio)
ignore the 3MF colors, so their own config files assign every part a filament in its
color. See docs/13-export-formats.md#3mf.
"""

import io
import json
import zipfile
from dataclasses import dataclass
from typing import Literal
from xml.sax.saxutils import escape

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw

from app import __version__
from app.services.export_stl import Body, StlOptions, build_bodies
from app.services.svg_geometry import VectorDocument

CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" '
    'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="model" '
    'ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
    '<Default Extension="png" ContentType="image/png"/>'
    "</Types>"
)
RELATIONSHIPS = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
    'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
    "{thumbnail}</Relationships>"
)
THUMBNAIL_PATH = "Metadata/thumbnail.png"
THUMBNAIL_RELATIONSHIP = (
    f'<Relationship Target="/{THUMBNAIL_PATH}" Id="rel1" '
    'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>'
)
# Thumbnail edge (px), drawn at SUPERSAMPLE times the size for smooth edges.
THUMBNAIL_PX = 256
SUPERSAMPLE = 4
MODEL_PATH = "3D/3dmodel.model"
# Orca / Bambu Studio project files: filament per object and part, and filament colors.
MODEL_SETTINGS_PATH = "Metadata/model_settings.config"
PROJECT_SETTINGS_PATH = "Metadata/project_settings.config"

# `assembly`: the bodies are parts of one model; `objects`: each body is a model of its
# own, which slicers can move, arrange and print separately (e.g. fitted inlay pieces).
Layout = Literal["assembly", "objects"]


@dataclass(frozen=True)
class ThreeMfOptions:
    """Package details: the model's name and well-known 3MF metadata (empty = left out)."""

    title: str = ""
    designer: str = ""
    description: str = ""
    layout: Layout = "assembly"
    # Assign filaments for Orca-based slicers (Anycubic Slicer Next, OrcaSlicer, Bambu Studio).
    slicer_config: bool = True
    # Top view of the colored model as the package thumbnail (file browsers, slicers).
    thumbnail: bool = True


def indexed_mesh(triangles: NDArray[np.float64]) -> tuple[NDArray[np.float64], NDArray[np.int64]]:
    """Shared vertices and per-triangle vertex indices (exactly equal points are merged)."""
    vertices, inverse = np.unique(triangles.reshape(-1, 3), axis=0, return_inverse=True)
    return vertices, inverse.reshape(-1, 3).astype(np.int64)


def _attributes(values: dict[str, str]) -> str:
    return "".join(
        f' {name}="{escape(value, {chr(34): "&quot;"})}"' for name, value in values.items()
    )


def _mesh_xml(body: Body) -> str:
    """`<mesh>` element as text (one string per vertex/triangle is far faster than lxml)."""
    vertices, faces = indexed_mesh(body.triangles)
    vertex_xml = "".join(
        f'<vertex x="{x:.4f}" y="{y:.4f}" z="{z:.4f}"/>' for x, y, z in vertices.tolist()
    )
    triangle_xml = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in faces.tolist())
    return f"<mesh><vertices>{vertex_xml}</vertices><triangles>{triangle_xml}</triangles></mesh>"


def _metadata(options: ThreeMfOptions) -> str:
    values = {
        "Application": f"VectorSnap {__version__}",
        "Title": options.title,
        "Designer": options.designer,
        "Description": options.description,
    }
    return "".join(
        f"<metadata{_attributes({'name': name})}>{escape(value)}</metadata>"
        for name, value in values.items()
        if value
    )


def model_xml(bodies: list[Body], options: ThreeMfOptions | None = None) -> str:
    """3MF core model: base materials (colors), one object per body, and one assembly of
    them as the build item — or, with the `objects` layout, every body as a build item."""
    options = options or ThreeMfOptions()
    materials = "".join(
        f"<base{_attributes({'name': body.name, 'displaycolor': f'{body.color.upper()}FF'})}/>"
        for body in bodies
    )
    parts = "".join(
        "<object"
        + _attributes(
            {
                "id": str(index + 2),
                "type": "model",
                "name": body.name,
                "pid": "1",
                "pindex": str(index),
            }
        )
        + f">{_mesh_xml(body)}</object>"
        for index, body in enumerate(bodies)
    )
    ids = [index + 2 for index in range(len(bodies))]
    if options.layout == "objects":
        assembly, items = "", ids
    else:
        assembly_id = len(bodies) + 2
        name = options.title or "VectorSnap"
        components = "".join(f'<component objectid="{i}"/>' for i in ids)
        assembly = (
            f"<object{_attributes({'id': str(assembly_id), 'type': 'model', 'name': name})}>"
            f"<components>{components}</components></object>"
        )
        items = [assembly_id]
    build = "".join(f'<item objectid="{i}"/>' for i in items)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<model unit="millimeter" xml:lang="en-US" xmlns="{CORE_NS}">'
        f"{_metadata(options)}"
        f'<resources><basematerials id="1">{materials}</basematerials>{parts}{assembly}'
        f"</resources><build>{build}</build></model>"
    )


def thumbnail_png(bodies: list[Body], size_px: int = THUMBNAIL_PX) -> bytes:
    """Top view of the model in its colors on a transparent background: the upward faces
    of every body, lower bodies first, so the colors seen from above end up on top."""
    points = np.concatenate([body.triangles.reshape(-1, 3) for body in bodies])
    low, high = points[:, :2].min(axis=0), points[:, :2].max(axis=0)
    canvas = size_px * SUPERSAMPLE
    margin = canvas * 0.04
    scale = (canvas - 2 * margin) / max(float((high - low).max()), 1e-9)
    offset = (canvas - (high - low) * scale) / 2  # centered
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for body in sorted(bodies, key=lambda item: float(item.triangles[..., 2].max())):
        triangles = body.triangles
        normals_z = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])[
            :, 2
        ]
        top = triangles[normals_z > 0][..., :2]
        pixels = (top - low) * scale + offset
        pixels[..., 1] = canvas - pixels[..., 1]  # image rows grow downwards
        for triangle in pixels.tolist():
            draw.polygon([tuple(point) for point in triangle], fill=body.color)
    buffer = io.BytesIO()
    image.resize((size_px, size_px), Image.Resampling.LANCZOS).save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def filament_slots(bodies: list[Body]) -> list[str]:
    """Filament colors in slot order: one slot per distinct color, the base plate's first."""
    return list(dict.fromkeys(body.color.upper() for body in bodies))


def _setting(key: str, value: str) -> str:
    return f"<metadata{_attributes({'key': key, 'value': value})}/>"


def _part_xml(object_id: int, body: Body, slot: int) -> str:
    return (
        f"<part{_attributes({'id': str(object_id), 'subtype': 'normal_part'})}>"
        f"{_setting('name', body.name)}{_setting('extruder', str(slot))}</part>"
    )


def model_settings_xml(bodies: list[Body], options: ThreeMfOptions | None = None) -> str:
    """Orca / Bambu Studio `model_settings.config`: names and the filament (1-based slot) of
    every part, by the object ids of `model_xml`."""
    options = options or ThreeMfOptions()
    slots = {color: index + 1 for index, color in enumerate(filament_slots(bodies))}
    slot = [slots[body.color.upper()] for body in bodies]
    if options.layout == "objects":
        objects = "".join(
            f"<object{_attributes({'id': str(index + 2)})}>{_setting('name', body.name)}"
            f"{_setting('extruder', str(slot[index]))}{_part_xml(index + 2, body, slot[index])}"
            "</object>"
            for index, body in enumerate(bodies)
        )
    else:
        parts = "".join(
            _part_xml(index + 2, body, slot[index]) for index, body in enumerate(bodies)
        )
        objects = (
            f"<object{_attributes({'id': str(len(bodies) + 2)})}>"
            f"{_setting('name', options.title or 'VectorSnap')}{_setting('extruder', '1')}"
            f"{parts}</object>"
        )
    return f'<?xml version="1.0" encoding="UTF-8"?><config>{objects}</config>'


def project_settings_json(bodies: list[Body]) -> str:
    """Orca / Bambu Studio `project_settings.config` with only the filament colors; the
    slicer keeps its own printer, process and filament settings."""
    return json.dumps({"filament_colour": filament_slots(bodies)})


def export_3mf(
    document: VectorDocument, options: StlOptions, package_options: ThreeMfOptions | None = None
) -> bytes:
    """Return a 3MF package with one colored part per body, assembled as one model."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", CONTENT_TYPES)
        bodies = build_bodies(document, options)
        thumbnail = (package_options or ThreeMfOptions()).thumbnail
        package.writestr(
            "_rels/.rels",
            RELATIONSHIPS.format(thumbnail=THUMBNAIL_RELATIONSHIP if thumbnail else ""),
        )
        if thumbnail:
            package.writestr(THUMBNAIL_PATH, thumbnail_png(bodies))
        package.writestr(MODEL_PATH, model_xml(bodies, package_options))
        if (package_options or ThreeMfOptions()).slicer_config:
            package.writestr(MODEL_SETTINGS_PATH, model_settings_xml(bodies, package_options))
            package.writestr(PROJECT_SETTINGS_PATH, project_settings_json(bodies))
    return buffer.getvalue()
