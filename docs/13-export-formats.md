# 13. Export Formats

Besides SVG (produced in the browser from the edited document, see
[08-svg-editor.md](08-svg-editor.md#export-)), VectorSnap converts documents to formats
for 3D printing, cutting and print. Conversion runs on the **backend**, so other clients
of the microservice can use it too.

| Format | Endpoint | Typical use | Status |
|--------|----------|-------------|--------|
| SVG | — (browser) | Web, design tools | ✅ |
| PNG | — (browser), `POST /api/v1/export/png` | Raster image at any width, transparent or one-color background | ✅ |
| STL | `POST /api/v1/export/stl` | 3D printing (relief / multi-color prints) | ✅ |
| 3MF | `POST /api/v1/export/3mf` | Multi-color / multi-material 3D printing (AMS, MMU, tool changers) | ✅ |
| 3MF tiles (ZIP) | `POST /api/v1/export/tiles` | A model larger than the bed, cut into tiles that each fit | ✅ |
| Cookie cutter (STL) | `POST /api/v1/export/cookie-cutter` | Cutter following the design's silhouette: blade and flange | ✅ |
| Coloring page (PDF) | `POST /api/v1/export/coloring-page` | Outlines to color in, or paint by numbers with a legend | ✅ |
| Stencil (SVG, DXF) | `POST /api/v1/export/stencil` | Sheet to cut for spray paint or screen printing; islands held by bridges | ✅ |
| Sticker (SVG, PDF) | `POST /api/v1/export/sticker` | Print-and-cut sticker: background around the design, `CutContour` cut line | ✅ |
| Lithophane (STL) | `POST /api/v1/export/lithophane` | Backlit photo plate made from the **original image** | ✅ |
| Layers (ZIP) | `POST /api/v1/export/layers` | One SVG, DXF or PDF per color: vinyl cutters, screen printing, laser cutting | ✅ |
| DXF | `POST /api/v1/export/dxf` | Laser cutters, vinyl plotters, CNC | ✅ |
| PDF | `POST /api/v1/export/pdf` | Print, documents | ✅ |
| EPS | `POST /api/v1/export/eps` | Design tools, print shops, older layout software | ✅ |
| Filament plan | `POST /api/v1/export/filament-plan` | Filament changes for multi-color prints on one extruder (JSON) | ✅ |
| Model size | `POST /api/v1/export/model-size` | Bounding box of the STL/3MF model, for the build volume (JSON) | ✅ |
| Print check | `POST /api/v1/export/print-check` | Shapes narrower than the nozzle where they print (JSON) | ✅ |
| Color changes | `POST /api/v1/export/color-changes` | Filament changes, time and purge of multi-color printers, filament per color (JSON) | ✅ |

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
| `stl_format` | `binary` | `binary` or `ascii` (STL and STL per part only) |
| `base_mm` | `1.0` | Base plate under all shapes (`0` = no base) |
| `base_shape` | `outline` | Base plate footprint: `outline` (follows the design), `rectangle`, `rounded` (rectangle with round corners), `circle` (smallest circle around the design), `oval` (ellipse through the corners of the bounding box grown by the margin) or `hexagon` (regular, flat top and bottom) |
| `base_margin_mm` | `0` | How far the base plate extends beyond the design (0–100) — a border around it |
| `layer_mm` | `1.0` | Extrusion height per color layer |
| `layered` | `true` | `true`: layer *n* (bottom to top) is *n × layer_mm* high (relief, easy color changes by height); `false`: all layers share one height |
| `layer_heights` | `{}` | JSON object `{"<paletteIndex>": mm}` overriding the height above the base per color (0 < h ≤ 100); **`0` leaves a color out** (e.g. print a logo without its background). Colors not listed follow `layer_mm` / `layered` |
| `shape_heights` | `{}` | JSON object `{"<shape id>": mm}` (ids from the SVG, e.g. `p-2-0`) giving **single elements** their own height above the base, overriding their color — raised details on a flat multi-color print. `0` leaves the shape out, unknown ids are ignored, heights snap to `print_layer_mm` |
| `filaments` | `[]` | **Mixed colors**: JSON list of the loaded filaments `["#rrggbb", ...]` (up to 16; e.g. the 4 AMS slots). The first one prints the base plate. With filaments, bodies are made per filament (see [Mixed colors](#mixed-colors-filament-stacks)) |
| `color_stacks` | `{}` | With `filaments`: per palette index `{"base": f, "top": [[f, mm], ...]}` — filament indices; `top` lists thin layers from the top surface down (up to 8), `base` fills the rest of the color's height. Every included color needs one |
| `stack_order` | `document` | Bottom-to-top order of the colors for automatic heights: `document` (as in the SVG — largest coverage at the bottom), `light_to_dark` or `dark_to_light` |
| `relief` | `raised` | `raised`: colors stand on the base plate; `inlay`: every color is sunk its height into the plate, flush with its top — a flat multi-color surface (coasters, signs, multi-material prints). The plate must be thicker than the deepest color; `engrave`: the colors are only cut out of the plate (lettering of missing filament, one filament), as deep as the plate = through |
| `rim_mm` | `0` | Raised rim along the outer edge of the base plate, this wide (0–50 mm) — coasters, signs, badges; needs `base_mm > 0`. `0` = no rim |
| `rim_height_mm` | `0` | Rim height above the base plate (0–100 mm); `0` = as high as the tallest color |
| `loop_hole_mm` | `0` | Hanging loop on top of the base plate with a hole of this diameter (0–20 mm) — keyrings, ornaments, hooks; needs `base_mm > 0`. `0` = no loop |
| `loop_position` | `top` | Side of the base plate the loop sticks out of: `top`, `right`, `bottom` or `left` (of the model as printed, after `mirror`) |
| `magnet_mm` | `0` | Round pocket in the underside of the base plate for a magnet (0–50 mm diameter; add ≈0.2 mm clearance, e.g. `10.2` for a 10 mm magnet). `0` = none |
| `magnet_depth_mm` | `2` | Pocket depth (0–20 mm); at least 0.4 mm of base plate must remain above it |
| `magnet_count` | `1` | Number of magnet pockets (1–4), spread along the plate's longer side — long signs and badges that should not tilt |
| `screw_holes` | `0` | Screw holes through the base plate beside the design: `0`, `2` (by the middle of the shorter sides) or `4` (by the corners) — signs to screw to a wall; needs `base_mm` > 0 |
| `screw_hole_mm` | `4` | Screw hole diameter (0–10) |
| `outline_mm` | `0` | Outline along every color's edges (0–5 mm), in a filament of its own — comic-style lines between colors on AMS prints; needs raised colors (not `inlay`, `engrave` or mixed colors) |
| `outline_color` | `#000000` | Outline filament (`#rrggbb`) |
| `outline_height_mm` | `0` | Outline height above the base (0–100); `0` = as high as the tallest color (a flat top), more stands out like a cookie cutter's edge |
| `elephant_foot_mm` | `0` | Elephant's foot compensation (0–0.5 mm): the first printer layer of the base plate (`print_layer_mm`, or 0.2 mm) is inset by this much, so the squashed first layer does not bulge past the walls; needs `base_mm > 0`. `0` = off |
| `mirror` | `false` | Mirror horizontally — for stamps or printing the top face down on the bed |
| `origin` | `corner` | Where the model sits: `corner` keeps the design's coordinates (x and y from 0), `center` puts the middle of its footprint at x = y = 0 — for CAD, CNC and tools that do not re-center imports. z always starts at 0 |
| `print_layer_mm` | `0` | Printer layer height (≤ 1 mm): the base and every color are rounded to whole layers, so each color ends exactly on a layer boundary; `0` keeps the exact heights |
| `min_feature_mm` | `0` | Remove every part narrower than this before extrusion — set it to the nozzle width (e.g. `0.4`); `0` keeps everything |
| `simplify_mm` | `0` | Simplify outlines (0–2 mm): points closer than this to the simplified outline are dropped — far fewer triangles and smaller files for traced photos; `0` keeps the outlines exact |
| `color_gap_mm` | `0` | Gap between neighbouring colors (0–2 mm): every color shrinks by half of it — parts printed separately and fitted together (inlays, puzzles, tolerances), or a clean edge between colors; the base plate keeps its outline. `0` = colors touch |

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
- **Per-element heights** (`shape_heights`): within a color, shapes are grouped by
  height; shapes with a height of their own become separate bodies named
  `color-<index>-<height>mm` (one 3MF part each, same color), so every body stays a
  closed prism. Shapes at their color's height merge with it; a shape keeps its own
  height even when its color is left out (`layer_heights` 0), and the base plate covers
  only included shapes. The filament plan sees raised parts like any other body.
- <a id="mixed-colors-filament-stacks"></a>**Mixed colors** (`filaments`, `color_stacks`):
  with only a few filaments (e.g. 4 AMS slots), thin layers of translucent filament
  printed over another filament blend into new colors when seen from above ("filament
  painting", as in HueForge: a thin red layer over white looks pink). Each color is
  printed as its stack: `top` layers from the top surface down (thicknesses snapped to
  `print_layer_mm`), the `base` filament below them up to the color's base — a color too
  low for all top layers keeps the topmost ones. Bodies are then one per **filament and
  height range** — `filament-<n>-<bottom>-<top>mm` (heights above the base plate, `n`
  1-based) — the union of every color that has that filament there, colored with the
  filament. So a 3MF has parts in the loaded filament colors only and a slicer maps
  them to the slots by color. The base plate is printed with the first filament.
  Choosing the stacks (which filaments and how thick) is up to the client; the 3D print
  step predicts the blend from each filament's transmission distance (TD)
  ([07-frontend.md](07-frontend.md)).
- Rings that touch at a single point — shapes meeting at a corner, or a hole touching
  its outline or another hole (valid polygons, common in traced photos) — would give a
  vertical edge shared by four triangles, which slicers and lib3mf report as
  non-manifold. Bodies with such pinch points are offset inward by 2 µm
  (`PINCH_SEPARATION_MM`); all other geometry stays exact. Verified with lib3mf in strict
  mode on a traced photo: every part manifold and oriented.
- **Printability** (`min_feature_mm`): a morphological opening per layer — shrink by
  half the width, grow back with mitred joins, clip to the original — removes lines,
  slivers and specks narrower than the nozzle, which slicers would drop or print as
  stringy blobs, while the remaining shapes keep their exact outline and sharp corners.
  The base plate is filtered the same way. If nothing is left, the export is
  `422 INVALID_PARAMETERS`.
- **Simplification** (`simplify_mm`): after scaling to millimetres, every color's outline
  is simplified with Douglas-Peucker (`shapely` `simplify`, topology preserved) to the
  tolerance, then repaired like other rounding damage. Curves traced from photos carry a
  point every ¼ px; at 0.1–0.3 mm the print looks the same with a fraction of the
  triangles. Colors are simplified independently, so seams between them may shift by up
  to the tolerance (the base plate below stays closed).
- **Color gap** (`color_gap_mm`): after overlaps and the rim are cut away, every
  color's visible area is offset inward by half the gap with mitred joins, so corners
  stay sharp and two colors that touched end exactly `color_gap_mm` apart. Outer edges
  shrink by half the gap too; details narrower than the gap disappear. With mixed colors
  the gap is applied per color before the filament bodies are united.
- **Raised rim** (`rim_mm`, `rim_height_mm`): a band along the outer edge of the base
  plate (after shape and margin, before the hanging loop), extruded from the top of the
  plate as one `rim` body in the base plate's color (the first filament with mixed
  colors). Holes in the plate get no rim. Colors under the band are cut away, so bodies
  never overlap; give the plate a margin at least as wide as the rim to keep the whole
  design visible. Without a base plate the export is `422 INVALID_PARAMETERS`.
- **Hanging loop** (`loop_hole_mm`): a ring with a 2 mm wall around the hole is added
  to the base plate, centered on the plate's top edge — on the topmost point closest to
  the middle — and reaching half a wall into the plate so it is solidly joined. The hole
  starts just above the plate, so it never cuts the design. It follows the base shape
  and margin; without a base plate the export is `422 INVALID_PARAMETERS`.
  `loop_position` puts it on another side the same way: the plate is turned so that
  side is on top, the loop added, and the plate turned back.
- **Magnet pocket** (`magnet_mm`, `magnet_depth_mm`): fridge magnets, magnetic
  badges. The pocket is placed at the **pole of inaccessibility** (`shapely.ops.polylabel`)
  of the largest base polygon — the point farthest from its outline and holes — and
  needs 1 mm of wall around it, otherwise the export is `422 INVALID_PARAMETERS` with the
  largest diameter that fits. With `magnet_count` > 1 the plate is cut into equal slices
  along its longer side and each slice gets a pocket at its own pole of inaccessibility;
  every pocket needs the 1 mm wall to the edge and to its neighbour, otherwise the export
  is `422 INVALID_PARAMETERS` (`field` `magnet_count`). Its depth must leave a 0.4 mm roof under the (layer-snapped)
  base top. The base body stays one closed mesh: a floor cap with the pocket as a hole,
  the pocket walls and a downward-facing pocket ceiling share their ring vertices;
  printed upside up, the ceiling bridges over the pocket.
- **Screw holes** (`screw_holes`, `screw_hole_mm`): round holes through the base plate,
  rim included, never through the design. Each hole goes as close to its spot as a
  1.5 mm wall to the plate's edge and to the design allows: two holes by the middle of
  the shorter sides (left and right of a wide plate, top and bottom of a tall one), four
  by the corners of the plate's bounding box. The design must leave room: a border of at
  least the diameter plus two walls (7 mm for 4 mm screws) or a plate shape that reaches
  beyond the design (`rectangle` corners). Without room, or with neighbouring holes
  closer than the diameter plus a wall, the export is `422 INVALID_PARAMETERS` (`field`
  `screw_holes`, the message names the border needed); a count other than 0, 2 or 4 is
  the same error. Magnet pockets are placed after the holes, so they avoid them.
- **Outlines** (`outline_mm`, `outline_color`, `outline_height_mm`): one body named
  `outline` in its own color, standing on the base plate. It is the band `outline_mm`
  wide centered on every edge between two colors, and inside the design along its outer
  edge, so it never sticks out over the plate's border; parts narrower than
  `min_feature_mm` are dropped. The colors are cut back by it, so nothing overlaps. It
  rises as high as the tallest color (snapped to `print_layer_mm`) or `outline_height_mm`
  above the base. Outlines need colors standing on the plate: with `relief` `inlay` or
  `engrave`, or with mixed colors, the export is `422 INVALID_PARAMETERS` (`field`
  `outline_mm`). In a 3MF the outline is one more filament, so it takes an AMS/ACE slot.
- **Elephant's foot** (`elephant_foot_mm`): the first layer is squashed onto the bed and
  bulges out, which spoils fitted parts and sharp bottom edges. The base plate's lowest
  `print_layer_mm` (0.2 mm when not set) is offset inward with mitred joins
  (`mesh.footed_prism`): one closed, manifold solid whose bottom steps in, so the magnet
  pocket can still reach above the step. Polygons too thin for the inset keep their
  bottom; a one-layer plate is inset entirely. Without a base plate the export is
  `422 INVALID_PARAMETERS`.
- **Inlay** (`relief=inlay`): each color's height becomes its depth below the top of the
  base plate, so the print has one flat top surface. The plate is the solid part below
  the deepest color (named `base`, with the magnet pocket and elephant's foot) plus one
  body per depth band, `base-<bottom>-<top>mm`, that is the plate minus the colors
  reaching that deep; stacked solids stay separate bodies because one body made of
  touching solids would not be manifold. Everything together fills the plate exactly
  (tests check balanced edges and the volume). Mixed-color ranges are named by their
  depth, `filament-<n>-inlay-<from>-<to>mm`. The plate must be thicker than the deepest
  color and a magnet pocket must fit below it, otherwise the export is
  `422 INVALID_PARAMETERS`. All colors end at the plate's top, so a single-extruder
  filament plan cannot separate them (it reports a conflict): inlays are for
  multi-material printers.
- **Engrave / cut out** (`relief=engrave`): lettering made of **missing filament**. The
  included colors (height > 0) are only cut out of the base plate, to their height; the
  colors left out (height 0) stay solid plate. The plate follows the whole design (or the
  chosen shape around it), so there is something to cut into, and takes the filament of
  the bottom color left solid. The bodies are those of the inlay — `base` below the
  deepest cut and the `base-<bottom>-<top>mm` bands — without the colored parts, so the
  model is **one filament**: no filament changes, simple to print on any printer.
  A color as deep as the plate **cuts through** (a stencil): there is no solid `base`, and
  areas enclosed by a cut-through color — the inside of an "O" or "A" — stay as loose
  pieces that are printed but not held by the plate. Deeper than the plate, no base plate
  or mixed colors (`filaments`) are `422 INVALID_PARAMETERS`. Checked with Anycubic
  Slicer Next (Kobra X profile): both an engraved and a cut-through plate slice with one
  filament (T0 only). The 3MF thumbnail is shaded by height, so an engraving shows.
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
- **Overlapping shapes** — bodies never overlap: a shape drawn above another one in the
  document (a later layer) owns its footprint, and that area is cut out of the parts
  below it (`_visible()`), whatever the `stack_order` or heights. Traced colors overlap
  the ones below them by 1 px (no gaps between colors), and shapes moved in the editor,
  placed fragments and `stacked` tracing overlap too; as
  overlapping bodies a slicer would assign the shared space to one part or the other
  unpredictably (especially with all colors at one height for AMS printers).
- The base plate (`base_shape=outline`) is the union of the **included** layers, so
  transparent areas, deleted shapes and colors left out with height 0 stay open.
- **Base plate shape**: with a margin, `outline` grows the design's outline with round
  joins (a sticker-like border; gaps narrower than twice the margin close).
  `rectangle`, `rounded` and `circle` enclose the whole design — the bounding box, the
  same with corners rounded concentrically (radius 15 % of the shorter side plus the
  margin), or the smallest enclosing circle — plus the margin, filling gaps and
  transparent areas: signs, coasters, badges. `oval` is the ellipse with the bounding
  box's proportions through the corners of the box grown by the margin (√2 times its
  half sides), so a wide design gets a wide oval. `hexagon` is a regular hexagon with a
  flat top and bottom, centered on the bounding box and just large enough for the
  design grown by the margin (round joins): coasters and badges that tile. The circle is a 128-gon circumscribing the
  true circle, so no part of the design sticks out. Round corners must not cut off a
  design that reaches into a corner of its bounding box (e.g. a rectangular
  background): the corner radius is then limited to just under (2 + √2) × the margin,
  the largest radius that still covers that corner — with no margin the plate keeps
  square corners. Leaving out every color is `422 INVALID_PARAMETERS`.
- **Origin** (`origin=center`): after all bodies are built, they are moved together so
  the middle of their combined bounding box (base plate, rim and loop included) is at
  x = y = 0; z is unchanged, so the model still stands on the bed.
- The model is built as **bodies** (base plate, one per color) — the STL contains them
  all; the same bodies feed other 3D formats.
- Output is binary STL (`model/stl`), units mm. With `stl_format=ascii` (STL and STL
  per part only) the same triangles come as ASCII STL — about five times larger, for
  older CAD/CAM tools and for reading or diffing the file; normals in `%e`, vertices with
  six decimals (1 nm).

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
`base_margin_mm`, `stack_order`, `relief`, `origin`, `simplify_mm`, `color_gap_mm`, `rim_mm`, `rim_height_mm`, `loop_hole_mm`, `loop_position`, `magnet_mm`, `magnet_depth_mm`, `magnet_count`, `elephant_foot_mm`, `layer_mm`, `layered`, `layer_heights`, `shape_heights`, `mirror`, `min_feature_mm`,
`print_layer_mm`, `filaments`, `color_stacks`), but packaged so a slicer keeps the colors apart — STL has no
notion of parts or colors.

- [3MF core specification](https://3mf.io/specification/) package: `[Content_Types].xml`,
  `_rels/.rels`, `3D/3dmodel.model`; `unit="millimeter"`.
- `<basematerials>` holds one display color per body; **every body is its own object**
  (`base`, `color-<paletteIndex>`) referencing its color.
- One **assembly object** with all bodies as components is the only build item, so
  Bambu Studio, OrcaSlicer and PrusaSlicer import the bodies as **parts of one model** —
  they stay aligned, and each part can get its own filament.
- `layout=objects` leaves out the assembly: every body is a **build item of its own**,
  so the slicer imports separate objects that can be moved, arranged and printed apart —
  e.g. inlay pieces cut with `color_gap_mm` and glued together afterwards. They keep the
  shared coordinates until the slicer arranges them.
- Optional package details (3MF only): `title` (up to 200 characters; also names the
  assembly, which slicers show as the object's name — default `VectorSnap`),
  `designer` (200) and `description` (2000) become the well-known 3MF metadata
  `Title`, `Designer` and `Description`; empty values are left out. `Application`
  always names the VectorSnap version.
- **Filaments for Orca-based slicers** (`slicer_config`, default on): Anycubic Slicer
  Next, OrcaSlicer and Bambu Studio ignore the 3MF colors and would put every part on
  filament 1 — a one-color print. So the package also holds their project files:
  `Metadata/model_settings.config` names every part and assigns it a filament
  (`extruder`, 1-based) and `Metadata/project_settings.config` holds only
  `filament_colour`, one filament per distinct color in slot order (the base plate shares
  the slot of the color it takes). The slicer keeps its own printer, process and filament
  settings. Other slicers ignore the files; `slicer_config=false` leaves them out.
  Verified with the Anycubic Slicer Next 2.0 command line and its Anycubic Kobra X 0.4
  profile (both layouts): every part prints with its own filament (T0–T3 for four
  colors) and the filaments take the design's colors; without the files the G-code
  used T0 only.
- **Thumbnail** (`thumbnail`, default on): `Metadata/thumbnail.png`, a 256 × 256 px top
  view of the model in its colors on a transparent background, linked as the package
  thumbnail (OPC relationship `…/metadata/thumbnail`), which file browsers and slicers
  show for the file. Drawn from the upward faces of the bodies, lower bodies first, so
  every area shows the color seen from above (`thumbnail_png`); `thumbnail=false` leaves
  it out.
- Meshes are **indexed**: identical vertices are merged and triangles reference them,
  which slicers need to recognise closed, manifold parts.
- Verified with the 3MF Consortium's reference library **lib3mf in strict mode**: no
  warnings, every part manifold and oriented, colors assigned. Unit tests check the
  package, materials, assembly, closed indexed meshes and that the total volume equals
  the STL export with the same options.
- A 440-shape document: 1.8 MB (STL: 8.8 MB) in ≈2 s.

## STL per part (ZIP)

```bash
curl -F svg=@logo.svg -F base_mm=1 http://localhost:8000/api/v1/export/stl-parts -o logo.zip
```

Same options and bodies as STL and 3MF, but **one binary STL per body** in a ZIP
(`export_stl_parts`), for slicers and printers that do not read colored 3MF parts: load
all files at once as one multi-part object (they share one coordinate system, so they
stay aligned) and give each part its filament. Files are numbered bottom to top and
named after the body and its color — `01-base-1d2b53.stl`, `02-color-0-1d2b53.stl`,
`03-rim-1d2b53.stl` … — and `colors.txt` lists every file, tab-separated: file name,
`#rrggbb` color, filament number (numbered like the 3MF: one per distinct color, the
base plate's first), lowest and highest z (mm) and volume (mm³):

```text
01-base-000000.stl	#000000	1	0	1	400.0
02-color-0-000000.stl	#000000	1	1	2	300.0
03-color-1-ff0000.stl	#ff0000	2	1	2	100.0
```

The first two columns are unchanged, so readers of the older two-column file keep
working; give every part the filament in the third column.
The 3D print step offers it as **STL per color (ZIP)**.

## Tiles (ZIP of 3MF)

```bash
curl -F svg=@sign.svg -F width_mm=400 -F base_mm=1.6 -F tile_x_mm=260 -F tile_y_mm=260 \
     -F title=Sign http://localhost:8000/api/v1/export/tiles -o sign-tiles.zip
```

A sign larger than the printer's bed is printed in parts. `POST /export/tiles` takes the
3MF form fields and the largest tile, `tile_x_mm` × `tile_y_mm` (10–10000 mm, default
220: the bed), and divides the model's footprint into the fewest equal tiles that fit
(`app/services/tiles.py`): a 410 mm wide plate on a 260 mm bed becomes two tiles of
205 mm. Every tile is the model clipped to its cell — base plate, rim, outlines and
colors are cut at the cell's edges (`build_bodies(clip=...)`), so the tiles fit edge to
edge into the whole sign — and a 3MF of its own, named by row from the top and column
from the left: `tile-r1-c1.3mf`, `tile-r1-c2.3mf` … Its title is the model's with the
row and column. `tiles.txt` lists them, tab-separated: file, row, column, width and
depth (mm):

```text
tile-r1-c1.3mf	1	1	205	130
tile-r1-c2.3mf	1	2	205	130
```

Outlines and color gaps follow the whole design, not the cut; holes and the hanging loop
stay where they are on the whole model, and magnet pockets crossed by a tile edge are
left out. Every tile starts at x = y = 0 (centered on 0 with `origin=center`), so it lies
on the bed as loaded — slicers' command lines do not arrange it. Cells the model leaves
empty (a round plate's corners) are skipped; more than 36 tiles is a `422` naming
`tile_x_mm`. Two tiles of a 410 × 260 mm sign sliced in Anycubic Slicer Next for the
Kobra X in 1 h 43 min and 1 h 52 min, with 3 and 4 filaments.

## Cookie cutter

```bash
curl -F svg=@star.svg -F width_mm=70 -F exclude_colors='[0]' \
     http://localhost:8000/api/v1/export/cookie-cutter -o star-cutter.stl
```

| Option | Default | Meaning |
|--------|---------|---------|
| `width_mm` | `80` | Cookie width (0–500); the cutter adds the blade and flange around it |
| `height_mm` | `15` | Cutter height (3–60) |
| `wall_mm` | `1.2` | Blade thickness (0.4–5): at least 2–3 nozzle widths |
| `flange_mm` | `4` | Flange width beyond the blade (0–20; 0 = blade only) |
| `flange_height_mm` | `2` | Flange height (< `height_mm`) |
| `smooth_mm` | `1` | Notches narrower than twice this are closed — dough cannot follow them (0–10) |
| `mirror` | `true` | Mirror the footprint: printed flange down, used flange up, the cookie reads right |
| `exclude_colors` | `[]` | Palette indices left out, such as a background around the design |

- `app/services/cookie_cutter.py`. The **silhouette**: every included layer united, in
  mm; holes filled (a cutter only cuts the outside); a morphological closing by
  `smooth_mm` removes narrow notches; pieces under 4 mm² (specks) are dropped. Separate
  pieces get separate cutters in the same file.
- The **blade** is the ring between the silhouette and its outward offset by `wall_mm`
  (round joins), so its inside is exactly the cookie; the **flange** is the ring out to
  `wall_mm + flange_mm` at the foot, `flange_height_mm` high, and the blade stands on it.
  Both are closed prisms that touch, like the base plate and colors of the STL export.
- The cutter starts at x = y = 0 and z = 0, flange down: print it that way, no supports.
- A design whose background covers the whole canvas gives a rectangular cutter: leave the
  background out with `exclude_colors` (or remove it in the palette step before tracing).
- Checked in Anycubic Slicer Next (Kobra X, 0.2 mm): the sample face, background left
  out, slices into an oval cutter of 67 × 55 mm, 4.9 g, 13 min.

## Sticker

```bash
curl -F svg=@face.svg -F border_mm=3 -F exclude_colors='[0]' -F sticker_format=pdf \
     http://localhost:8000/api/v1/export/sticker -o face-sticker.pdf
```

| Option | Default | Meaning |
|--------|---------|---------|
| `sticker_format` | `svg` | `svg` (mm) or `pdf` (page fitted to the cut line plus `margin_mm`) |
| `width_mm` | `70` | Design width (0–1000); the border comes on top |
| `border_mm` | `3` | Background beyond the design's silhouette (0–50; 0 = cut along the design) |
| `background` | `#ffffff` | Background color, `#rrggbb` |
| `smooth_mm` | `1` | Notches narrower than twice this are closed: a cutter blade cannot follow them (0–10) |
| `margin_mm` | `5` | PDF page margin around the cut line (0–100) |
| `exclude_colors` | `[]` | Palette indices left out, such as a background around the design |

- `app/services/sticker.py`. The **silhouette** is the cookie cutter's (holes filled,
  notches closed, specks under 4 mm² dropped), grown by `border_mm` with round joins.
  Separate pieces become separate stickers on one sheet.
- The file stacks the **background** (the grown silhouette in `background`), the
  **design** (the kept colors, exact curves) and the **cut line**: a hairline along the
  background's edge, a path with id `CutContour` in magenta in the SVG and the spot color
  (separation) `CutContour`, overprinted, in the PDF. Roland, Mimaki and Summa RIPs cut
  along that spot color without printing it; Cricut and Silhouette import the SVG for
  print-then-cut.
- A design whose background covers the whole canvas gives a rectangular sticker: leave
  it out with `exclude_colors`.

## Coloring page

```bash
curl -F svg=@face.svg -F exclude_colors='[0]' \
     http://localhost:8000/api/v1/export/coloring-page -o face-coloring.pdf
```

| Option | Default | Meaning |
|--------|---------|---------|
| `page` | `a4` | `a4` or `letter`; landscape when the design is wider than tall |
| `margin_mm` | `12` | Page margin (0–50) |
| `line_mm` | `0.4` | Outline width (0.1–3) |
| `numbers` | `true` | Paint by numbers: numbered regions and a legend; `false` = plain coloring page |
| `exclude_colors` | `[]` | Palette indices left white and unnumbered, such as the background |

- `app/services/coloring_page.py`. Every shape keeps what it **shows**: shapes above it
  are cut out (stacked SVGs would otherwise outline hidden edges). The edges of those
  regions are drawn black, scaled to fit the page and hung from the top margin.
- **Numbers** follow the order colors first appear, bottom to top. Each region gets its
  number at its pole of inaccessibility (the point farthest from its edges, `polylabel`),
  4.5–14 pt to fit; slivers too thin for 4.5 pt stay unnumbered. The legend under the
  drawing shows each color as a swatch with its number and hex value.

## Stencil

```bash
curl -F svg=@logo.svg -F width_mm=150 -F exclude_colors='[0]' -D - \
     http://localhost:8000/api/v1/export/stencil -o logo-stencil.svg
```

| Option | Default | Meaning |
|--------|---------|---------|
| `stencil_format` | `svg` | `svg` (mm) or `dxf` (R2010, mm, layers `sheet` and `cuts`) |
| `width_mm` | `100` | Design width (0–10000) |
| `margin_mm` | `10` | Sheet around the cuts (1–100) |
| `bridge_mm` | `1.5` | Bridge width (0.2–20) |
| `bridges` | `horizontal` | `horizontal`, `vertical` or `both` (two bridges each way: sturdier, more to touch up) |
| `exclude_colors` | `[]` | Palette indices left out, such as the background |

- `app/services/stencil.py`. The **cuts** are the kept colors united (pieces under
  1 mm² dropped); the **sheet** is the rectangle `margin_mm` around them.
- **Bridges**: every piece of sheet the cuts set loose (the middle of an O, a ring
  between two cuts) gets a line through it in the first direction; the stretches of cut
  that line crosses on both sides of the piece stay sheet, `bridge_mm` wide. Pieces still
  loose afterwards (held only by other loose pieces) get bridges the other way, so the
  sheet always comes out in one piece. The `X-Stencil-Bridges` header says how many.
- The SVG has the sheet outline and the cuts (black, even-odd); cutting software follows
  both as paths.

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

### On the server

Clients without a browser get the same image from `POST /api/v1/export/png`
(`app/services/export_png.py`):

```bash
curl -F svg=@logo.svg -F width_px=1200 -F background=#ffffff \
     http://localhost:8000/api/v1/export/png -o logo.png
```

| Option | Default | Meaning |
|--------|---------|---------|
| `width_px` | `1024` | Image width (16–4096); the height follows the aspect ratio |
| `background` | `transparent` | `transparent` or a color, `#rrggbb` |
| `dpi` | `300` | Resolution stored in the file (72–1200), so print tools open it at a size |

- Every shape is filled in its own color, bottom layer first; holes follow the even-odd
  rule like the 3D exports (`to_polygon`). Curves are flattened to a quarter of a pixel.
- Edges are anti-aliased by drawing 4× larger and scaling down (Lanczos); the larger
  canvas stays at most 6144 px a side, so 4096 px wide images are drawn 1×.
- Each shape is drawn through a mask of its own bounding box, so the cost grows with
  the shapes' area, not their number times the image.

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

## Model size

```bash
curl -F svg=@logo.svg -F width_mm=80 -F base_shape=circle -F base_margin_mm=4 \
     http://localhost:8000/api/v1/export/model-size
```

`POST /export/model-size` takes the STL/3MF form fields and returns the bounding box of
the exported model — base plate, border, rim and hanging loop included — to check it
against a printer's build volume before downloading: `{"x_mm": 102.371, "y_mm": 108.371,
"z_mm": 4.8}`. A border, the circle around the design and the loop do not scale with
`width_mm`, so the size is computed from the exported bodies
(`model_size` in `app/services/export_stl.py`). Anycubic Slicer Next's `--info` reports
the same size for the 3MF (checked on a round plate with a loop: 102.37 × 108.37 × 4.8).

## Print check

```bash
curl -F svg=@logo.svg -F width_mm=40 -F nozzle_mm=0.4 \
     http://localhost:8000/api/v1/export/print-check
```

A nozzle cannot lay down lines narrower than itself: slicers skip them, and the 3D
exports drop them with `min_feature_mm`. `POST /export/print-check` takes the STL/3MF
form fields and `nozzle_mm` (default 0.4) and returns the shapes at least half of whose
printed area is narrower than the nozzle, most thin area first:

```json
{"nozzle_mm": 0.4, "thin_mm2": 19.9,
 "shapes": [{"id": "p-4-0", "palette_index": 4, "color": "#3b2f2a",
             "area_mm2": 3.603, "thin_mm2": 3.603, "vanishes": true}]}
```

The printed area is what the 3D model shows of a shape: at the model's size and mirror,
without left-out colors and without what shapes drawn above cover (a shape mostly hidden
under the next color can leave a strip too thin to print). `vanishes` marks shapes of
which nothing prints; `thin_mm2` at the top level is the thin area of the whole design.
Thin shapes print once the model is wider or a finer nozzle is used
(`app/services/print_check.py`).

## Color changes of multi-color printers

```bash
curl -F svg=@logo.svg -F base_mm=0.6 -F print_layer_mm=0.2 -F change_s=49 -F purge_mm3=226 \
     http://localhost:8000/api/v1/export/color-changes
```

Printers with one nozzle and several loaded filaments (Anycubic ACE, Bambu AMS, Prusa
MMU) print every layer color by color and change the filament in between; each change
takes time and purges filament into a prime tower. `POST /export/color-changes` takes
the same form fields as STL/3MF (`print_layer_mm` is required) and counts the changes of
the 3MF, one filament per distinct color:

```json
{
  "filaments": [
    { "color": "#000000", "volume_mm3": 1740.2, "grams": 2.16 },
    { "color": "#ff0000", "volume_mm3": 410.5, "grams": 0.51 }
  ],
  "layers": 13,
  "changes": 4,
  "max_colors_per_layer": 2,
  "change_time_s": 196.0,
  "purge_mm3": 904.0,
  "purge_g": 1.12
}
```

- Layers are printed bottom-up; a layer of n colors costs n − 1 changes, plus one when
  it cannot start with the filament the previous layer ended with. Each layer ends with
  a filament the next layer needs, like the slicer orders them
  (`app/services/color_changes.py`).
- `change_s`, `purge_mm3` (per change) and `density_g_cm3` (default PLA, 1.24) turn the
  count into time and purged filament; 0 leaves them out. For the **Anycubic Kobra X**
  (Anycubic Slicer Next 2.0, 0.4 nozzle profile): about **53 s** per change and
  **226 mm³** (flush volume 280 mm³ × multiplier 0.7 + prime volume 30 mm³ ≈ 0.28 g PLA).
  The time is the slicer's estimate with the prime tower: the same model sliced in one
  color took 7 min 5 s, in two colors with 10 changes 15 min 56 s.
- `filaments`: how much of each filament the model takes, one entry per distinct color
  in 3MF filament order (the base plate counts for its color) — the **solid** volume of
  its bodies and its weight at `density_g_cm3`. Slicers print the inside with sparse
  infill, so this is an upper bound: on a 2 mm plate Anycubic Slicer Next (Kobra X,
  15 % infill, 2 walls, 5 top and 3 bottom layers) estimated 3.64 g for 4.46 g solid.
  Enough to tell whether a spool's rest will do and how the colors share the print.
- Checked against Anycubic Slicer Next on the same 3MF: 2 flat colors over 10 layers →
  10 changes, 4 flat colors over 5 layers → 15, 2 stepped colors sharing 2 layers → 3,
  each as counted here. Every layer with n colors costs n − 1 changes, so the count shows
  what thinner colors or fewer colors save — stepped colors are not always cheaper, as
  every step stands on the base and the lower layers hold all colors.

## Layers (ZIP)

```bash
curl -F svg=@logo.svg -F layer_format=dxf -F width_mm=300 \
     http://localhost:8000/api/v1/export/layers -o logo-layers.zip
```

| Option | Default | Meaning |
|--------|---------|---------|
| `layer_format` | `svg` | `svg`, `dxf` or `pdf`: the format of every color's file |
| `width_mm` | `100` | Drawing width of the DXF and PDF files (and the areas in `colors.txt`) |
| `margin_mm` | `0` | Page margin of the PDF files |

- One file per **color** (`app/services/export_layers.py`): shapes are grouped by their
  effective color — a shape with its own color goes to that color's file — in the order
  the colors first appear bottom to top: `color-01-ffffff.svg`, `color-02-ff0000.svg`, …
- Every file keeps the **whole canvas** — the same SVG viewBox, DXF coordinates and PDF
  page — so the sheets line up again when stacked: a vinyl sheet per color, a screen per
  color, a laser-cut material per color.
- `colors.txt`: file, color, shape count and area in mm² at `width_mm`, tab-separated —
  how much vinyl or material each color takes.
- The single-color files are made by the SVG serializer (`svg_edit.serialize_svg`, the
  VectorSnap contract) and the DXF and PDF exporters below.

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

## EPS

```bash
curl -F svg=@logo.svg -F width_mm=80 \
     http://localhost:8000/api/v1/export/eps -o logo.eps
```

| Option | Default | Meaning |
|--------|---------|---------|
| `width_mm` | `100` | Drawing width; height follows the aspect ratio |
| `margin_mm` | `0` | Empty space around the drawing inside the bounding box |

- Encapsulated PostScript (EPSF-3.0, LanguageLevel 2), written directly: a short prolog
  of one-letter procedures, then one filled path per shape; the fill color is only set
  when it changes. `%%BoundingBox` (whole points, rounded up) and `%%HiResBoundingBox`
  match the drawing plus margins.
- Same curves as the PDF (`curve_path` in `svg_geometry.py`): cubic Béziers stay curves,
  quadratic curves are converted exactly, arcs via cubic approximation; holes are
  subpaths filled with the **nonzero** rule, like SVG.
- Tests check the header, bounding box, colors, the mm → point mapping with the y flip
  and that curves stay `curveto`. The output was checked once by rendering it with
  Ghostscript (`-dEPSCrop`): shape, hole and background match the PDF test.

## Frontend

Common options are always shown; less common ones sit in collapsed sections (for STL and
3MF: **Base plate extras** — shape, margin, loop, magnet — **Print tuning** — color
order, detail removal, layer snapping, outline simplification, gap between colors,
elephant's foot, raised or inlaid colors — and **File** — position (`origin`) plus the
STL encoding or the 3MF parts layout; `section` in `src/lib/exportFormats.ts`). A
collapsed section's header shows how many of its options differ from the defaults
("2 changed") or, when one is invalid, "1 to fix" in the error color, so a disabled
Export button is never left unexplained.

Long exports show progress: below the buttons a status line ("Building the STL file ·
12 s", the time appears after 2 s so quick exports never flicker) with **Cancel**, which
aborts the request (`AbortController`); nothing is downloaded and no error is shown. The
3D preview does the same while it loads ("Building model… 12 s", a note that detailed
designs can take a minute, **Cancel** closes the preview). `src/lib/elapsed.ts` formats
the time. The export panel and the 3D print step share this behaviour through the
`useExport` hook (`src/lib/useExport.ts`: one export at a time, download, error
message, cancel — a build that ignores the signal, like PNG rendering, is dropped after
cancelling) and the `ExportProgress` status line.

For STL and 3MF the panel also lists every color with an *include* checkbox and a height field
(empty = automatic, shown as placeholder — following the chosen color order and already rounded to the printer layer height
when one is set); this becomes `layer_heights`. Leaving out
every color disables the export with an explanation. The rules mirror the backend and
live in `src/lib/colorHeights.ts` (automatic heights, brightness order, layer snapping,
the `layer_heights` value and its validation).

The model starts **flat**: the panel sends `layered=false` until *Stack colors at
increasing heights (relief)* is ticked, so the first preview shows every color at the
same height. A height entered for a color raises it above the others, and **Reset
heights** makes the model flat again. The 3D print step works the same way: colors start
level, extra layers raise a color or selected elements, and **Make all colors flat
again** clears the color raises.

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
- The WebGL-free part — parsing, statistics, laying the model on the plate, disposing —
  lives in `src/lib/modelScene.ts` and is tested on real STL / 3MF data generated in the
  tests (`src/test/models.ts`); `ModelPreview` itself is tested with a stand-in renderer.

The result step has an **Export to other formats** panel: choose STL, 3MF, lithophane, cookie cutter, colors (ZIP), DXF, PDF, EPS or PNG, adjust
its options (number, checkbox and choice options, validated in the browser with the same
ranges as the API; each format remembers its own values) and download the file named
after the uploaded image (`logo.png` → `logo.stl`). The export always uses
the **edited** document. Formats are declared in `src/lib/exportFormats.ts`.
