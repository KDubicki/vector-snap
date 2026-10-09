# 13. Export Formats

Besides SVG (produced in the browser from the edited document, see
[08-svg-editor.md](08-svg-editor.md#export-)), VectorSnap converts documents to formats
for 3D printing, cutting and print. Conversion runs on the **backend**, so other clients
of the microservice can use it too.

| Format | Endpoint | Typical use | Status |
|--------|----------|-------------|--------|
| SVG | — (browser) | Web, design tools | ✅ |
| PNG | — (browser) | Raster image at any width, transparent or white background | ✅ |
| STL | `POST /api/v1/export/stl` | 3D printing (relief / multi-color prints) | ✅ |
| 3MF | `POST /api/v1/export/3mf` | Multi-color / multi-material 3D printing (AMS, MMU, tool changers) | ✅ |
| Lithophane (STL) | `POST /api/v1/export/lithophane` | Backlit photo plate made from the **original image** | ✅ |
| DXF | `POST /api/v1/export/dxf` | Laser cutters, vinyl plotters, CNC | ✅ |
| PDF | `POST /api/v1/export/pdf` | Print, documents | ✅ |
| Filament plan | `POST /api/v1/export/filament-plan` | Filament changes for multi-color prints on one extruder (JSON) | ✅ |

All endpoints except the lithophane take `multipart/form-data` with an `svg` file in the
[SVG output contract](05-api-specification.md#svg-output-contract) plus format options,
and return the file as an attachment. Invalid SVG → `422 INVALID_SVG`. The lithophane
takes the uploaded JPEG/PNG as `image` instead.

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
| `base_shape` | `outline` | Base plate footprint: `outline` (follows the design), `rectangle`, `rounded` (rectangle with round corners) or `circle` (smallest circle around the design) |
| `base_margin_mm` | `0` | How far the base plate extends beyond the design (0–100) — a border around it |
| `layer_mm` | `1.0` | Extrusion height per color layer |
| `layered` | `true` | `true`: layer *n* (bottom to top) is *n × layer_mm* high (relief, easy color changes by height); `false`: all layers share one height |
| `layer_heights` | `{}` | JSON object `{"<paletteIndex>": mm}` overriding the height above the base per color (0 < h ≤ 100); **`0` leaves a color out** (e.g. print a logo without its background). Colors not listed follow `layer_mm` / `layered` |
| `stack_order` | `document` | Bottom-to-top order of the colors for automatic heights: `document` (as in the SVG — largest coverage at the bottom), `light_to_dark` or `dark_to_light` |
| `loop_hole_mm` | `0` | Hanging loop on top of the base plate with a hole of this diameter (0–20 mm) — keyrings, ornaments, hooks; needs `base_mm > 0`. `0` = no loop |
| `magnet_mm` | `0` | Round pocket in the underside of the base plate for a magnet (0–50 mm diameter; add ≈0.2 mm clearance, e.g. `10.2` for a 10 mm magnet). `0` = none |
| `magnet_depth_mm` | `2` | Pocket depth (0–20 mm); at least 0.4 mm of base plate must remain above it |
| `mirror` | `false` | Mirror horizontally — for stamps or printing the top face down on the bed |
| `print_layer_mm` | `0` | Printer layer height (≤ 1 mm): the base and every color are rounded to whole layers, so each color ends exactly on a layer boundary; `0` keeps the exact heights |
| `min_feature_mm` | `0` | Remove every part narrower than this before extrusion — set it to the nozzle width (e.g. `0.4`); `0` keeps everything |

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
- Scaling to millimetres (and mirroring) rounds coordinates, which can make nearly
  touching rings — e.g. a chain of sliver holes meeting at their corners, common in
  traced photos — cross each other. Such layers are repaired with `make_valid` before
  extrusion; GEOS cannot triangulate self-intersecting polygons.
- **Printability** (`min_feature_mm`): a morphological opening per layer — shrink by
  half the width, grow back with mitred joins, clip to the original — removes lines,
  slivers and specks narrower than the nozzle, which slicers would drop or print as
  stringy blobs, while the remaining shapes keep their exact outline and sharp corners.
  The base plate is filtered the same way. If nothing is left, the export is
  `422 INVALID_PARAMETERS`.
- **Hanging loop** (`loop_hole_mm`): a ring with a 2 mm wall around the hole is added
  to the base plate, centered on the plate's top edge — on the topmost point closest to
  the middle — and reaching half a wall into the plate so it is solidly joined. The hole
  starts just above the plate, so it never cuts the design. It follows the base shape
  and margin; without a base plate the export is `422 INVALID_PARAMETERS`.
- **Magnet pocket** (`magnet_mm`, `magnet_depth_mm`): fridge magnets, magnetic
  badges. The pocket is placed at the **pole of inaccessibility** (`shapely.ops.polylabel`)
  of the largest base polygon — the point farthest from its outline and holes — and
  needs 1 mm of wall around it, otherwise the export is `422 INVALID_PARAMETERS` with the
  largest diameter that fits. Its depth must leave a 0.4 mm roof under the (layer-snapped)
  base top. The base body stays one closed mesh: a floor cap with the pocket as a hole,
  the pocket walls and a downward-facing pocket ceiling share their ring vertices;
  printed upside up, the ceiling bridges over the pocket.
- **Stack order** (`stack_order`): with `light_to_dark` / `dark_to_light` the colors are
  ranked by WCAG relative luminance (equally bright colors keep the document order)
  before automatic heights are assigned, so e.g. dark outlines and text end up on top
  of a light background — the usual order for filament swaps. The bottom color also
  prints the base plate. Explicit `layer_heights` are not affected.
- **Layer snapping** (`print_layer_mm`): the base thickness and every color height
  (automatic or explicit) are rounded half-up to whole printer layers, keeping at least
  one layer, so the top of each color — where a filament change has to happen — falls on
  a layer the slicer actually prints, instead of being rounded by the slicer. E.g. with
  0.2 mm layers a 0.5 mm color becomes 0.6 mm. The slicer's first-layer height is
  assumed equal to the layer height.
- The base plate (`base_shape=outline`) is the union of the **included** layers, so
  transparent areas, deleted shapes and colors left out with height 0 stay open.
- **Base plate shape**: with a margin, `outline` grows the design's outline with round
  joins (a sticker-like border; gaps narrower than twice the margin close).
  `rectangle`, `rounded` and `circle` enclose the whole design — the bounding box, the
  same with corners rounded concentrically (radius 15 % of the shorter side plus the
  margin), or the smallest enclosing circle — plus the margin, filling gaps and
  transparent areas: signs, coasters, badges. The circle is a 128-gon circumscribing the
  true circle, so no part of the design sticks out. Leaving out every color is
  `422 INVALID_PARAMETERS`.
- The model is built as **bodies** (base plate, one per color) — the STL contains them
  all; the same bodies feed other 3D formats.
- Output is binary STL (`model/stl`), units mm.

Tests check real mesh properties, not just the file: every body is **closed** (each
edge shared by exactly two triangles in opposite directions — for touching bodies:
balanced directed edges), the **signed volume equals area × height** (which also proves
outward normals), dimensions in mm and layer heights. Performance: a 440-shape document
exports in ≈1.5 s (≈177 k triangles, 8.8 MB).

## 3MF

```bash
curl -F svg=@logo.svg -F base_mm=1 -F layer_heights='{"0": 0}' \
     http://localhost:8000/api/v1/export/3mf -o logo.3mf
```

Same options and the same bodies as STL (`width_mm`, `base_mm`, `base_shape`,
`base_margin_mm`, `stack_order`, `loop_hole_mm`, `magnet_mm`, `magnet_depth_mm`, `layer_mm`, `layered`, `layer_heights`, `mirror`, `min_feature_mm`,
`print_layer_mm`), but packaged so a slicer keeps the colors apart — STL has no
notion of parts or colors.

- [3MF core specification](https://3mf.io/specification/) package: `[Content_Types].xml`,
  `_rels/.rels`, `3D/3dmodel.model`; `unit="millimeter"`.
- `<basematerials>` holds one display color per body; **every body is its own object**
  (`base`, `color-<paletteIndex>`) referencing its color.
- One **assembly object** with all bodies as components is the only build item, so
  Bambu Studio, OrcaSlicer and PrusaSlicer import the bodies as **parts of one model** —
  they stay aligned, and each part can get its own filament.
- Meshes are **indexed**: identical vertices are merged and triangles reference them,
  which slicers need to recognise closed, manifold parts.
- Verified with the 3MF Consortium's reference library **lib3mf in strict mode**: no
  warnings, every part manifold and oriented, colors assigned. Unit tests check the
  package, materials, assembly, closed indexed meshes and that the total volume equals
  the STL export with the same options.
- A 440-shape document: 1.8 MB (STL: 8.8 MB) in ≈2 s.

## Lithophane

`app/services/lithophane.py`. A thin plate whose thickness follows the **brightness of
the original image** (not the SVG — photos keep every shade): held against a light,
thick dark areas let less light through, so the photo appears.

- The image (transparent pixels composited over white, so they print thin) is converted
  to Rec. 709 luma and resampled bilinearly to a grid with `resolution_mm` spacing,
  `width_mm` wide; rows follow the aspect ratio.
- Thickness = `max_thickness_mm` − (max − min) × brightness: black → `max_thickness_mm`
  (default 3), white → `min_thickness_mm` (default 0.8). `invert` swaps it (bright areas
  thick), which turns the plate into a relief.
- `frame_mm` adds a solid border at full thickness around the image, so the plate is
  stiffer and stands upright.
- Mesh: the height grid is the top surface (two triangles per cell), side walls follow
  the border and the flat bottom (z = 0) is a fan around its center, so the mesh is
  closed and oriented (tests check every edge is shared by exactly two triangles in
  opposite directions and that volumes match). Binary STL, millimetres, flat side down.
- The grid is limited to 1,000,000 points (~100 MB STL); larger requests get
  `422 INVALID_PARAMETERS` with `field: resolution_mm`. `max_thickness_mm` ≤
  `min_thickness_mm` → `422` with `field: max_thickness_mm`.
- The default 100 mm at 0.2 mm on a 4:3 photo: ≈188k points, ≈19 MB, well under a second.
- Print it upright (or flat, relief up) in white filament with 100% infill; view it lit
  from behind.

## PNG

Rendered in the browser from the edited document (`src/lib/raster.ts`) — no request to
the backend:

| Option | Default | Meaning |
|--------|---------|---------|
| `width_px` | `2048` | Image width (16–16384); the height follows the aspect ratio |
| `background` | `transparent` | `transparent` keeps removed colors and empty areas see-through; `white` fills them |

- The serialized SVG is loaded into an `<img>`, drawn onto a canvas of the target size
  (vector shapes are rasterized at full resolution, not upscaled) and encoded with
  `canvas.toBlob('image/png')`.
- Sizes are capped at **16.7 megapixels** (the largest canvas Safari renders): larger
  requests are scaled down proportionally, and the panel shows the actual output size
  before exporting.

## Filament change plan

```bash
curl -F svg=@logo.svg -F base_mm=0.6 -F print_layer_mm=0.2 \
     http://localhost:8000/api/v1/export/filament-plan
```

Single-extruder printers can still print a layered relief in several colors: pause at
the height where one color ends and swap the filament, so everything above comes out in
the next color and the top face of every region gets its own color. `POST
/export/filament-plan` takes the same form fields as STL/3MF and returns where to change:

```json
{
  "steps": [
    { "z_mm": 0.0, "layer": 1, "color": "#000000" },
    { "z_mm": 1.6, "layer": 9, "color": "#ff0000" }
  ],
  "conflicts": [],
  "height_mm": 2.6
}
```

- The plan is derived from the **exported bodies** (`app/services/filament_plan.py`), so
  it reflects per-color heights, left-out colors, removed details and layer snapping.
- The first step is the starting filament (the base plate uses the bottom color). Each
  band between two consecutive tops is printed in the color of the bodies ending at the
  upper one; consecutive bands of the same color need no change.
- `layer` is the first printer layer in the new color (1-based), only with
  `print_layer_mm` set — the number to enter in the slicer's layer slider.
- **Conflicts**: different colors ending at the same height (e.g. `layered=false`)
  cannot be separated by filament changes; they need different heights or a
  multi-material printer.

## DXF

```bash
curl -F svg=@logo.svg -F width_mm=300 -F fill=false \
     http://localhost:8000/api/v1/export/dxf -o logo.dxf
```

| Option | Default | Meaning |
|--------|---------|---------|
| `width_mm` | `100` | Drawing width; height follows the aspect ratio |
| `fill` | `false` | Also add a solid `HATCH` per polygon (holes as inner boundaries) — for previews or engraving; cutters usually only need outlines |

- DXF R2010 written with [ezdxf](https://ezdxf.mozman.at/), `$INSUNITS = 4`
  (millimetres), metric measurement.
- **One DXF layer per color group** (`color-<paletteIndex>`) with its true color, so
  cutter software can assign power/speed or tools per color.
- Every polygon becomes **closed `LWPOLYLINE`s** — the outline plus one per hole.
- Shapes of one color are united first (same geometry pipeline as STL), so pieces split
  in the editor do not produce double cuts along their shared edge; same mm scaling and
  y flip as STL.
- Tests read the file back with ezdxf (layers, colors, closed outlines, extent in mm,
  hatch boundaries) and require a clean **ezdxf audit** (no errors, no fixes).

## PDF

```bash
curl -F svg=@logo.svg -F page=a4 -F margin_mm=15 \
     http://localhost:8000/api/v1/export/pdf -o logo.pdf
```

| Option | Default | Meaning |
|--------|---------|---------|
| `page` | `fit` | `fit`: the page is the drawing plus margins; `a4` / `letter`: standard page, orientation chosen from the drawing's aspect ratio, drawing scaled to fit inside the margins and centered |
| `width_mm` | `100` | Drawing width for `page=fit` |
| `margin_mm` | `10` | Margin on every side |

- Written with [ReportLab](https://www.reportlab.com/); one page, compressed streams,
  title/creator metadata.
- **Curves stay curves**: no flattening — every path segment becomes a native PDF path
  operator (cubic Bézier → `c`; quadratic curves are converted exactly to cubic; arcs via
  cubic approximation), so the output is resolution-independent and small (a 440-shape
  document: 0.24 MB in 0.18 s).
- Each shape is filled in its own color with the **nonzero** rule, like SVG, so holes
  render the same as in the browser.
- Tests render the PDF with pdfium and check pixel colors (shape, hole, background),
  page size and centering, and inspect path segments to make sure Béziers are kept.

## Frontend

Common options are always shown; less common ones sit in collapsed sections (for STL and
3MF: **Base plate extras** — shape, margin, loop, magnet — and **Print tuning** — color
order, detail removal, layer snapping; `section` in `src/lib/exportFormats.ts`). A
collapsed section's header shows how many of its options differ from the defaults
("2 changed") or, when one is invalid, "1 to fix" in the error color, so a disabled
Export button is never left unexplained.

For STL and 3MF the panel also lists every color with an *include* checkbox and a height field
(empty = automatic, shown as placeholder — following the chosen color order and already rounded to the printer layer height
when one is set); this becomes `layer_heights`. Leaving out
every color disables the export with an explanation.

### Filament changes

For STL and 3MF, **Plan filament changes** shows the plan for the current options: the
starting color, every change with its layer and height, conflicts, and a **Copy** button
for the plain-text version. Changing any option hides the plan so it never shows stale
heights.

### Lithophane

Uses the image from the upload step (the request sends `file`, not the SVG); the export
is saved as `<name>.lithophane.stl`. The thickness check (thickest > thinnest) runs in
the browser; the grid-size limit is left to the backend, which knows the image size.

### 3D preview

For STL, 3MF and the lithophane, **Preview 3D** shows the model before downloading it
(the lithophane loads its STL with `STLLoader`, as one plain part in white; switching
between the lithophane and the colored formats closes the other preview):

- It loads exactly what the backend exports — the **3MF** for the current options — with
  three.js' `3MFLoader`, so every part has its color and per-color heights, excluded
  colors and mirroring are visible.
- Orbit controls (rotate, zoom, pan) over a build-plate grid; the 3MF z-up model is laid
  on the plate.
- Print statistics computed from the meshes (`src/lib/meshStats.ts`, unit-tested):
  bounding box in mm, volume in cm³, **solid filament weight** for PLA / PETG / ABS / TPU
  (densities 1.24 / 1.27 / 1.04 / 1.21 g/cm³ — an upper bound, slicers with infill will
  report less), number of parts and triangles.
- three.js is **lazy-loaded**: the ≈150 kB (gzip) viewer chunk is only downloaded when a
  preview is opened. The canvas size comes from an observed wrapper element (see the
  HiDPI note in [08-svg-editor.md](08-svg-editor.md#testing)); renderer, controls,
  geometries and materials are disposed on close.

The result step has an **Export to other formats** panel: choose STL, 3MF, DXF, PDF or PNG, adjust
its options (number, checkbox and choice options, validated in the browser with the same
ranges as the API; each format remembers its own values) and download the file named
after the uploaded image (`logo.png` → `logo.stl`). The export always uses
the **edited** document. Formats are declared in `src/lib/exportFormats.ts`.
