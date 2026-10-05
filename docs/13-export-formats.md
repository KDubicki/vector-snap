# 13. Export Formats

Besides SVG (produced in the browser from the edited document, see
[08-svg-editor.md](08-svg-editor.md#export-)), VectorSnap converts documents to formats
for 3D printing, cutting and print. Conversion runs on the **backend**, so other clients
of the microservice can use it too.

| Format | Endpoint | Typical use | Status |
|--------|----------|-------------|--------|
| SVG | — (browser) | Web, design tools | ✅ |
| STL | `POST /api/v1/export/stl` | 3D printing (relief / multi-color prints) | ✅ |
| DXF | `POST /api/v1/export/dxf` | Laser cutters, vinyl plotters, CNC | 🔜 |
| PDF | `POST /api/v1/export/pdf` | Print, documents | 🔜 |

All endpoints take `multipart/form-data` with an `svg` file in the
[SVG output contract](05-api-specification.md#svg-output-contract) plus format options,
and return the file as an attachment. Invalid SVG → `422 INVALID_SVG`.

## Shared geometry (`app/services/svg_geometry.py`)

1. **Parse** the contract with lxml (no entity resolution, no network, no huge trees).
   Groups (`<g data-palette-index fill>`) become layers bottom to top; paths keep their
   own `fill` if set.
2. **Path data** is read with svgelements — all SVG commands, absolute and relative
   (the editor writes Paper.js path data such as `h`, `v`, `c`).
3. **Flatten** curves to polylines where a format needs polygons: quadratic and cubic
   Béziers are evaluated vectorized with NumPy; the number of samples comes from the
   control-polygon length (an upper bound of the arc length) and a tolerance of
   0.25 px. Arcs are converted to cubic curves first.
4. **Polygons** are built with Shapely using even-odd semantics (rings inside rings are
   holes), which matches how the tracer encodes holes.

## STL

```bash
curl -F svg=@logo.svg -F width_mm=120 -F base_mm=1.5 -F layer_mm=0.8 \
     http://localhost:8000/api/v1/export/stl -o logo.stl
```

| Option | Default | Meaning |
|--------|---------|---------|
| `width_mm` | `100` | Model width; height follows the aspect ratio |
| `base_mm` | `1.0` | Base plate under all shapes (`0` = no base) |
| `layer_mm` | `1.0` | Extrusion height per color layer |
| `layered` | `true` | `true`: layer *n* (bottom to top) is *n × layer_mm* high (relief, easy color changes by height); `false`: all layers share one height |

Model construction:

- Coordinates are scaled to millimetres and the **y axis is flipped** (SVG y points
  down; without the flip the print would be mirrored).
- Shapes of one layer are united, so adjacent pieces (e.g. after splitting in the
  editor) do not produce internal walls; outlines are simplified with a 0.05 px
  tolerance to drop the many collinear points of straight edges traced as curves.
- Each polygon becomes a **closed prism**: caps from GEOS **constrained Delaunay**
  triangulation (`shapely.constrained_delaunay_triangles`, robust for polygons with
  dozens of holes) and walls from every ring edge. Caps and walls share the exact ring
  vertices, so every body is watertight with outward normals.
- The base plate is the union of all layers, so transparent areas (or deleted shapes)
  stay open.
- Output is binary STL (`model/stl`), units mm.

Tests check real mesh properties, not just the file: every body is **closed** (each
edge shared by exactly two triangles in opposite directions — for touching bodies:
balanced directed edges), the **signed volume equals area × height** (which also proves
outward normals), dimensions in mm and layer heights. Performance: a 440-shape document
exports in ≈1.5 s (≈177 k triangles, 8.8 MB).

## Frontend

The result step has an **Export to other formats** panel: choose a format, adjust its
options (validated in the browser with the same ranges as the API) and download the
file named after the uploaded image (`logo.png` → `logo.stl`). The export always uses
the **edited** document. Formats are declared in `src/lib/exportFormats.ts`.
