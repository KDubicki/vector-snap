# 05. API Specification

Base path: `/api/v1`. The machine-readable contract is the OpenAPI document served by
the backend at `/openapi.json` (Swagger UI at `/docs`, ReDoc at `/redoc`; disabled when
`VECTORSNAP_ENV=production` unless explicitly enabled).

All processing endpoints accept `multipart/form-data` because they receive binary images.
Responses are JSON unless stated otherwise. Errors use the format described in
[04-backend.md](04-backend.md#error-handling).

## Overview

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/health` | Liveness probe |
| `GET`  | `/api/v1/health/ready` | Readiness probe |
| `GET`  | `/api/v1/limits` | Server-side limits (for client-side validation/UI) |
| `POST` | `/api/v1/quantize` | Reduce an image to N colors, return indexed PNG + palette |
| `POST` | `/api/v1/suggest-colors` | Suggest a color count for an image |
| `POST` | `/api/v1/vectorize` | Convert an image to SVG |
| `POST` | `/api/v1/export/stl` | SVG → STL 3D model ([details](13-export-formats.md#stl)) |
| `POST` | `/api/v1/export/3mf` | SVG → multi-color 3MF ([details](13-export-formats.md#3mf)) |
| `POST` | `/api/v1/export/dxf` | SVG → DXF outlines per color ([details](13-export-formats.md#dxf)) |
| `POST` | `/api/v1/export/pdf` | SVG → vector PDF ([details](13-export-formats.md#pdf)) |
| `POST` | `/api/v1/export/eps` | SVG → Encapsulated PostScript ([details](13-export-formats.md#eps)) |
| `POST` | `/api/v1/export/filament-plan` | Filament changes for single-extruder prints ([details](13-export-formats.md#filament-change-plan)) |
| `POST` | `/api/v1/export/model-size` | Size of the STL/3MF model, for the build volume ([details](13-export-formats.md#model-size)) |
| `POST` | `/api/v1/export/print-check` | Shapes of the STL/3MF model narrower than the nozzle ([details](13-export-formats.md#print-check)) |
| `POST` | `/api/v1/export/color-changes` | Filament changes, time and purge of multi-color printers ([details](13-export-formats.md#color-changes-of-multi-color-printers)) |

---

## `GET /api/v1/health`

**200 OK**

```json
{"status": "ok", "version": "0.1.0"}
```

## `GET /api/v1/health/ready`

**200 OK** — `{"status": "ready"}` · **503** — `{"status": "not_ready", "reason": "..."}`

## `GET /api/v1/limits`

**200 OK**

```json
{
  "max_upload_mb": 10,
  "max_image_dimension": 4096,
  "min_colors": 2,
  "max_colors": 64,
  "supported_formats": ["image/jpeg", "image/png"]
}
```

---

## `POST /api/v1/quantize`

Reduces the image to `colors` representative colors.

### Request (`multipart/form-data`)

| Field | Type | Required | Default | Description |
|-------|------|:--------:|---------|-------------|
| `image` | file | ✅ | — | JPEG or PNG |
| `colors` | int | ✅ | — | Target palette size, `min_colors ≤ colors ≤ max_colors` |
| `algorithm` | enum | | `kmeans` | `kmeans` \| `median_cut` \| `filaments` (palette chosen from `filaments`) |
| `locked_colors` | JSON string | | `[]` | Hex colors that MUST be part of the palette, e.g. `["#ff0000"]` (counts toward `colors`); honored by every algorithm |
| `filaments` | JSON string | with `filaments` | `[]` | Available filament colors (up to 128), e.g. `["#ffffff", "#000000", "#c12e1f"]`; the best `colors` of them become the palette, unused ones are left out (`422 INVALID_PARAMETERS` when missing) |
| `max_working_size` | int | | `1024` | Image is downscaled to this longer side for clustering; labels are then assigned at full resolution |
| `seed` | int | | `0` | Random seed (deterministic output) |
| `upscale` | bool | | `false` | Enlarge images whose longer side is under 1024 px (whole factor, at most 4×) before quantizing, for smoother outlines; `width`/`height` report the enlarged size |
| `smooth` | int 0–3 | | `0` | Clean up noisy color regions with a (2n+1)² majority filter; colors that vanish are dropped |
| `min_coverage` | float 0–0.5 | | `0` | Merge every color covering less than this share of the image (`0.02` = 2 %) into its nearest other color (CIE Lab), smallest first, so the palette may end up with fewer than `colors`; locked colors stay, one color always stays. Listed in `merged` |

### Response — 200 OK

```json
{
  "width": 800,
  "height": 600,
  "palette": [
    {"index": 0, "hex": "#1d2b53", "rgb": [29, 43, 83], "coverage": 0.412},
    {"index": 1, "hex": "#ff004d", "rgb": [255, 0, 77], "coverage": 0.133}
  ],
  "has_transparency": false,
  "background_index": 0,
  "merged": [{"hex": "#5a5a5a", "into": "#1d2b53", "coverage": 0.012}],
  "image": {
    "media_type": "image/png",
    "encoding": "base64",
    "data": "iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

- `palette` is sorted by `coverage` descending; `index` equals the PNG palette index.
- `merged` lists the colors `min_coverage` merged away, smallest first: the color, the
  palette color its pixels now have (after any later merges) and its share before
  merging; empty when nothing was merged.
- `image` is an **indexed (mode `P`) PNG**. If the source had transparency, the
  transparent index is excluded from `palette` and marked via the PNG `tRNS` chunk.
- `coverage` is the fraction (0–1) of opaque pixels assigned to that color.
- `background_index` is the palette index covering at least half of the image border —
  a likely background a client can offer to remove (`background` in `/vectorize`) —
  or `null` (mixed border, or a border that is already transparent).
- The palette can be **smaller than `colors`** when the image has fewer distinct colors
  (e.g. a 3-color logo quantized to 8 colors returns exactly its 3 colors).

### Errors

`413 FILE_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `422 IMAGE_TOO_LARGE`,
`422 INVALID_IMAGE` (corrupt file, no opaque pixels), `422 INVALID_PARAMETERS` (`colors`
outside `min_colors…max_colors`, malformed `locked_colors`), `422 VALIDATION_ERROR`
(missing/mistyped fields; `details.errors` lists `loc`, `msg`, `type` per field).

---

## `POST /api/v1/suggest-colors`

Suggests a value for `colors`: the fewest colors whose mean perceptual error stays at or
below a target, see [06 §3](06-image-processing-pipeline.md#color-count-suggestion).

### Request (`multipart/form-data`)

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `image` | file | ✅ | JPEG or PNG |

### Response — 200 OK

```json
{
  "colors": 4,
  "target_delta_e": 5.0,
  "errors": [
    { "colors": 2, "mean_delta_e": 46.55 },
    { "colors": 3, "mean_delta_e": 16.42 },
    { "colors": 4, "mean_delta_e": 4.45 }
  ]
}
```

- `colors` is within `min_colors…max_colors`.
- `errors` is the mean CIE76 ΔE between the image and its k-means reduction for every
  evaluated count; it is empty for flat images, whose exact color count is returned.

### Errors

`413 FILE_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `422 IMAGE_TOO_LARGE`,
`422 INVALID_IMAGE`.

---

## `POST /api/v1/vectorize`

Converts an image to SVG. Two input modes are supported:

1. **Indexed mode (used by the frontend).** `image` is the indexed PNG returned by
   `/quantize`. Its label map is used as-is. `palette` optionally overrides colors.
2. **One-shot mode (microservice convenience).** `image` is any JPEG/PNG and `colors`
   is provided — the backend quantizes internally and then vectorizes.

If `image` is not indexed and `colors` is omitted, the request fails with
`422 INVALID_PARAMETERS`.

### Request (`multipart/form-data`)

| Field | Type | Required | Default | Description |
|-------|------|:--------:|---------|-------------|
| `image` | file | ✅ | — | Indexed PNG (mode 1) or JPEG/PNG (mode 2) |
| `palette` | JSON string | | — | Array of hex colors, one per palette index, e.g. `["#000000", "#ffcc00"]`. Length MUST equal the palette size. Two entries with the same color are merged into one group. |
| `colors` | int | mode 2 | — | Palette size for one-shot mode |
| `algorithm` | enum | | `kmeans` | One-shot mode only |
| `mode` | enum | | `spline` | `spline` (smooth curves) \| `polygon` (straight segments) |
| `filter_speckle` | int | | `4` | Discard regions smaller than this many px (side length) |
| `corner_threshold` | int | | `60` | Minimum angle (deg) considered a corner |
| `length_threshold` | float | | `4.0` | Minimum segment length (spline mode), `3.5…10` |
| `splice_threshold` | int | | `45` | Minimum angle displacement to splice a spline |
| `path_precision` | int | | `2` | Decimal places in path coordinates |
| `transparent` | JSON string | | `[]` | Palette indices to leave out everywhere, e.g. `[2]`; their pixels are treated as transparent. The response palette keeps them (coverage 0) so indices stay stable. All colors → `422 INVALID_PARAMETERS` |
| `background` | JSON string | | `[]` | Palette indices to leave out **only where they reach the image border**, e.g. `[0]` to remove a white background: regions of these colors connected (side by side, not diagonally; through transparent pixels too) to the border become transparent, while the same color enclosed by the motif — white eyes, the inside of letters — stays. The palette keeps them, with the coverage of what is left. Nothing left → `422 INVALID_PARAMETERS` |
| `stacking` | enum | | `cutout` | `cutout` (no overlaps; required for clean splitting and recoloring) \| `stacked` (each color layer extends under the layers above it — no seams between colors, but shapes overlap) |

### Content negotiation

| `Accept` header | Response |
|-----------------|----------|
| `application/json` (default) | JSON envelope below |
| `image/svg+xml` | Raw SVG document (useful for CLI / other services) |

### Response — 200 OK (`application/json`)

```json
{
  "width": 800,
  "height": 600,
  "palette": [
    {"index": 0, "hex": "#1d2b53", "rgb": [29, 43, 83], "coverage": 0.412},
    {"index": 1, "hex": "#ff004d", "rgb": [255, 0, 77], "coverage": 0.133}
  ],
  "stats": {"paths": 214, "bytes": 48213, "duration_ms": 812},
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 600\" ...>...</svg>"
}
```

### SVG output contract

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600"
     data-generator="vectorsnap/0.1.0">
  <g id="color-0" data-palette-index="0" fill="#1d2b53">
    <path id="p-0-0" data-palette-index="0" d="M..."/>
    <path id="p-0-1" data-palette-index="0" d="M..."/>
  </g>
  <g id="color-1" data-palette-index="1" fill="#ff004d">
    <path id="p-1-0" data-palette-index="1" d="M..."/>
  </g>
</svg>
```

- One `<g>` per palette color that has pixels, ordered back-to-front by coverage
  (largest first). Palette entries with identical colors (merged via `palette`) form a
  single group carrying the lowest index.
- Only palette colors appear in the output — exactly as sent in `palette`.
- `fill` is set on the group; individual paths MAY override it after editing.
- Shapes with holes are single paths with multiple subpaths (even-odd compatible).
- Path ids follow `p-{paletteIndex}-{sequence}` and are unique within the document.
- No transforms on paths — coordinates are absolute in the `viewBox` space.

### Errors

Same as `/quantize`, plus `422 INVALID_PARAMETERS` (palette length mismatch, invalid hex,
missing `colors` in one-shot mode).

---

## `POST /api/v1/export/{format}`

Converts an SVG in the [output contract](#svg-output-contract) to another format.
Request: `multipart/form-data` with an `svg` file and format options; response: the file
as an attachment (`Content-Disposition: attachment; filename="vectorsnap.<ext>"`).
Formats, options and geometry are described in [13-export-formats.md](13-export-formats.md).

**True/false form fields** that default to `true` (`layered`, and `slicer_config` and
`thumbnail` of the 3MF) are read as text — `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`;
anything else is `422 INVALID_PARAMETERS` — so leaving them out keeps the default.
FastAPI 0.149 and later read a missing `bool` form field as an unchecked checkbox (false).

| Format | Media type | Options |
|--------|------------|---------|
| `stl` | `model/stl` | `width_mm` (0–10000, default 100), `base_mm` (0–100, 1), `layer_mm` (0–100, 1), `layered` (bool, true), `layer_heights` (JSON `{"<index>": mm}`, 0 = omit), `shape_heights` (JSON `{"<shape id>": mm}`, per element, overrides its color; 0 = omit), `mirror` (bool, false), `origin` (`corner` \| `center`), `min_feature_mm` (0–10, 0), `simplify_mm` (0–2, 0), `color_gap_mm` (0–2, 0), `print_layer_mm` (0–1, 0), `base_shape` (`outline` \| `rectangle` \| `rounded` \| `circle` \| `oval` \| `hexagon`), `base_margin_mm` (0–100, 0), `stack_order` (`document` \| `light_to_dark` \| `dark_to_light`), `relief` (`raised` \| `inlay` \| `engrave`; inlay needs `base_mm` > deepest color; engrave cuts the colors out of the plate, `base_mm` ≥ deepest, equal = through), `rim_mm` (0–50, 0; needs `base_mm` > 0), `rim_height_mm` (0–100, 0 = tallest color), `loop_hole_mm` (0–20, 0; needs `base_mm` > 0), `loop_position` (`top` \| `right` \| `bottom` \| `left`), `magnet_mm` (0–50, 0), `magnet_depth_mm` (0–20, 2; ≤ `base_mm` − 0.4), `magnet_count` (1–4, 1), `screw_holes` (0, 2 or 4, 0; needs `base_mm` > 0), `screw_hole_mm` (0–10, 4), `outline_mm` (0–5, 0; raised colors only), `outline_color` (`#rrggbb`, `#000000`), `outline_height_mm` (0–100, 0 = tallest color), `elephant_foot_mm` (0–0.5, 0; needs `base_mm` > 0), `filaments` (JSON `["#rrggbb", ...]`, up to 16; mixed colors), `color_stacks` (JSON `{"<index>": {"base": f, "top": [[f, mm], ...]}}`, filament indices, up to 8 top layers; required for every included color when `filaments` is set), `stl_format` (`binary` \| `ascii`) |
| `3mf` | `model/3mf` | same as `stl`, without `stl_format`; plus `title` (≤ 200 characters, names the model), `designer` (≤ 200), `description` (≤ 2000) — 3MF metadata, empty = left out; `layout` (`assembly` \| `objects`: every body a separate model); `slicer_config` (default `true`: filament per part and filament colors for Orca-based slicers such as Anycubic Slicer Next); `thumbnail` (default `true`: colored top view as the package thumbnail) |
| `stl-parts` | `application/zip` | same as `stl` (including `stl_format`); one STL per body plus `colors.txt` (file, color, filament number, z range, volume) |
| `tiles` | `application/zip` | same as `3mf`; plus `tile_x_mm`, `tile_y_mm` (10–10000, 220): the largest tile. One 3MF per tile, `tile-r<row>-c<column>.3mf`, plus `tiles.txt` (file, row, column, width, depth); at most 36 tiles |
| `lithophane` | `model/stl` | Takes `image` (the JPEG/PNG upload) instead of `svg`. `width_mm` (0–1000, default 100), `min_thickness_mm` (0.2–10, 0.8), `max_thickness_mm` (0.2–20, 3; > `min_thickness_mm`), `resolution_mm` (0.05–5, 0.2; at most 1,000,000 grid points), `frame_mm` (0–50, 0), `invert` (bool, false) |
| `dxf` | `image/vnd.dxf` | `width_mm` (0–10000, default 100), `fill` (bool, false) |
| `pdf` | `application/pdf` | `page` (`fit` \| `a4` \| `letter`, default `fit`), `width_mm` (0–10000, 100), `margin_mm` (0–100, 10) |
| `eps` | `application/postscript` | `width_mm` (0–10000, default 100), `margin_mm` (0–100, 0) |

Errors: `413 FILE_TOO_LARGE`, `422 INVALID_SVG` (not well-formed, not SVG, no
viewBox/size, no shapes), `422 VALIDATION_ERROR` (options out of range).

---

## Examples

```bash
# Quantize to 8 colors
curl -s -F image=@logo.png -F colors=8 http://localhost:8000/api/v1/quantize | jq '.palette'

# One-shot: JPEG → SVG file
curl -s -H 'Accept: image/svg+xml' \
     -F image=@photo.jpg -F colors=6 -F mode=polygon \
     http://localhost:8000/api/v1/vectorize -o out.svg
```

## Versioning policy

- Backward-compatible additions (new optional fields, new endpoints) are made within `v1`.
- Breaking changes require a new prefix (`/api/v2`); the previous version is kept for at
  least one minor release.
