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
| `POST` | `/api/v1/vectorize` | Convert an image to SVG |
| `POST` | `/api/v1/export/stl` | SVG → STL 3D model ([details](13-export-formats.md#stl)) |
| `POST` | `/api/v1/export/3mf` | SVG → multi-color 3MF ([details](13-export-formats.md#3mf)) |
| `POST` | `/api/v1/export/dxf` | SVG → DXF outlines per color ([details](13-export-formats.md#dxf)) |
| `POST` | `/api/v1/export/pdf` | SVG → vector PDF ([details](13-export-formats.md#pdf)) |

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
| `algorithm` | enum | | `kmeans` | `kmeans` \| `median_cut` |
| `locked_colors` | JSON string | | `[]` | Hex colors that MUST be part of the palette, e.g. `["#ff0000"]` (counts toward `colors`); honored by both algorithms |
| `max_working_size` | int | | `1024` | Image is downscaled to this longer side for clustering; labels are then assigned at full resolution |
| `seed` | int | | `0` | Random seed (deterministic output) |

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
  "image": {
    "media_type": "image/png",
    "encoding": "base64",
    "data": "iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

- `palette` is sorted by `coverage` descending; `index` equals the PNG palette index.
- `image` is an **indexed (mode `P`) PNG**. If the source had transparency, the
  transparent index is excluded from `palette` and marked via the PNG `tRNS` chunk.
- `coverage` is the fraction (0–1) of opaque pixels assigned to that color.
- The palette can be **smaller than `colors`** when the image has fewer distinct colors
  (e.g. a 3-color logo quantized to 8 colors returns exactly its 3 colors).

### Errors

`413 FILE_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `422 IMAGE_TOO_LARGE`,
`422 INVALID_IMAGE` (corrupt file, no opaque pixels), `422 INVALID_PARAMETERS` (`colors`
outside `min_colors…max_colors`, malformed `locked_colors`), `422 VALIDATION_ERROR`
(missing/mistyped fields; `details.errors` lists `loc`, `msg`, `type` per field).

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

| Format | Media type | Options |
|--------|------------|---------|
| `stl` | `model/stl` | `width_mm` (0–10000, default 100), `base_mm` (0–100, 1), `layer_mm` (0–100, 1), `layered` (bool, true), `layer_heights` (JSON `{"<index>": mm}`, 0 = omit), `mirror` (bool, false) |
| `3mf` | `model/3mf` | same as `stl` |
| `dxf` | `image/vnd.dxf` | `width_mm` (0–10000, default 100), `fill` (bool, false) |
| `pdf` | `application/pdf` | `page` (`fit` \| `a4` \| `letter`, default `fit`), `width_mm` (0–10000, 100), `margin_mm` (0–100, 10) |

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
