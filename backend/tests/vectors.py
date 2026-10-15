"""Helpers for SVG/vector export tests."""

import numpy as np
from numpy.typing import NDArray

SVG_NS = "http://www.w3.org/2000/svg"


def contract_svg(width: float, height: float, groups: list[tuple[str, list[str]]]) -> bytes:
    """Build an SVG in the VectorSnap contract: [(fill, [path d, ...]), ...] bottom to top."""
    body = "".join(
        f'<g id="color-{i}" data-palette-index="{i}" fill="{fill}">'
        + "".join(f'<path id="p-{i}-{j}" d="{d}"/>' for j, d in enumerate(paths))
        + "</g>"
        for i, (fill, paths) in enumerate(groups)
    )
    return (
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 {width} {height}" width="{width}" '
        f'height="{height}">{body}</svg>'
    ).encode()


def read_binary_stl(data: bytes) -> NDArray[np.float64]:
    """Triangles of a binary STL as an (N, 3, 3) array."""
    count = int(np.frombuffer(data, dtype="<u4", count=1, offset=80)[0])
    dtype = np.dtype([("normal", "<f4", (3,)), ("vertices", "<f4", (3, 3)), ("attr", "<u2")])
    assert len(data) == 84 + count * dtype.itemsize
    return np.frombuffer(data, dtype=dtype, offset=84)["vertices"].astype(np.float64)


def read_ascii_stl(data: bytes) -> NDArray[np.float64]:
    """Triangles of an ASCII STL as an (N, 3, 3) array."""
    lines = data.decode().splitlines()
    assert lines[0].startswith("solid") and lines[-1].startswith("endsolid")
    vertices = [[float(v) for v in line.split()[1:]] for line in lines if "vertex" in line]
    assert sum("facet normal" in line for line in lines) * 3 == len(vertices)
    return np.array(vertices, dtype=np.float64).reshape(-1, 3, 3)


def signed_volume(triangles: NDArray[np.float64]) -> float:
    """Volume enclosed by a closed mesh; positive when normals point outward."""
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6)


def is_closed(triangles: NDArray[np.float64]) -> bool:
    """Every edge is shared by exactly two triangles in opposite directions."""
    edges: dict[tuple[tuple[float, ...], tuple[float, ...]], int] = {}
    for triangle in np.round(triangles, 5):
        for i in range(3):
            a, b = tuple(triangle[i]), tuple(triangle[(i + 1) % 3])
            edges[(a, b)] = edges.get((a, b), 0) + 1
    return all(count == 1 and edges.get((b, a)) == 1 for (a, b), count in edges.items())


def is_balanced(triangles: NDArray[np.float64]) -> bool:
    """Every directed edge has as many reverse edges: holds for any set of closed meshes,
    including touching bodies (base plate and layers) that share edges."""
    edges: dict[tuple[tuple[float, ...], tuple[float, ...]], int] = {}
    for triangle in np.round(triangles, 5):
        for i in range(3):
            key = (tuple(triangle[i]), tuple(triangle[(i + 1) % 3]))
            edges[key] = edges.get(key, 0) + 1
    return all(edges.get((b, a), 0) == count for (a, b), count in edges.items())
