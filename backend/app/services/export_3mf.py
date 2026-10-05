"""Export a vector document as 3MF for multi-color / multi-material 3D printing.

The bodies of the STL export (base plate and one per color) become separate 3MF objects
with their color, combined into one assembly: slicers import them as parts of a single
model that stay aligned and can each get their own filament (AMS, MMU, tool changers).
See docs/13-export-formats.md#3mf.
"""

import io
import zipfile
from xml.sax.saxutils import escape

import numpy as np
from numpy.typing import NDArray

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
    "</Types>"
)
RELATIONSHIPS = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
    'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
    "</Relationships>"
)
MODEL_PATH = "3D/3dmodel.model"


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


def model_xml(bodies: list[Body]) -> str:
    """3MF core model: base materials (colors), one object per body, one assembly."""
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
    assembly_id = len(bodies) + 2
    components = "".join(f'<component objectid="{index + 2}"/>' for index in range(len(bodies)))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<model unit="millimeter" xml:lang="en-US" xmlns="{CORE_NS}">'
        f'<metadata name="Application">VectorSnap {escape(__version__)}</metadata>'
        f'<resources><basematerials id="1">{materials}</basematerials>{parts}'
        f'<object id="{assembly_id}" type="model" name="VectorSnap">'
        f"<components>{components}</components></object></resources>"
        f'<build><item objectid="{assembly_id}"/></build></model>'
    )


def export_3mf(document: VectorDocument, options: StlOptions) -> bytes:
    """Return a 3MF package with one colored part per body, assembled as one model."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", CONTENT_TYPES)
        package.writestr("_rels/.rels", RELATIONSHIPS)
        package.writestr(MODEL_PATH, model_xml(build_bodies(document, options)))
    return buffer.getvalue()
