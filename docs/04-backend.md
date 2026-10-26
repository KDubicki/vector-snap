# 04. Backend Service

## Technology stack

| Purpose | Library | Notes |
|---------|---------|-------|
| Web framework | FastAPI + Uvicorn | Async, automatic OpenAPI schema |
| Validation / settings | Pydantic v2, pydantic-settings | Env-based configuration |
| Image decoding | Pillow | JPEG/PNG, EXIF transpose, decompression-bomb guard |
| Numerics | NumPy | Pixel arrays |
| Quantization | scikit-learn (`MiniBatchKMeans`), Pillow (`MEDIANCUT`) | See [pipeline](06-image-processing-pipeline.md) |
| Vectorization | vtracer (Python bindings, Rust core) | Multi-color tracing, spline/polygon output |
| SVG post-processing | lxml | Parsing, sanitization, annotation |
| Tooling | ruff, mypy, pytest, httpx | Lint, types, tests |

## Directory layout

```
backend/
├── Dockerfile
├── pyproject.toml
├── app/
│   ├── main.py                 # App factory, middleware, router registration
│   ├── core/
│   │   ├── config.py           # Settings (pydantic-settings, VECTORSNAP_* env vars)
│   │   ├── errors.py           # Domain exceptions + HTTP exception handlers
│   │   └── logging.py          # Structured JSON logging, request-id middleware
│   ├── api/
│   │   ├── deps.py             # Shared dependencies (size-limited upload reading)
│   │   ├── export_forms.py     # Form dependencies of the exports (SVG, 3D and 3MF options)
│   │   ├── router.py           # Aggregates routers under /api/v1
│   │   └── routes/
│   │       ├── health.py       # /health, /health/ready, /limits
│   │       ├── export.py       # /export/* (STL, 3MF, DXF, PDF, EPS, lithophane, estimates)
│   │       ├── quantize.py
│   │       ├── svg.py          # /svg/* (server-side SVG edits)
│   │       └── vectorize.py
│   ├── schemas/
│   │   ├── export.py           # export form parsers, filament plan / estimate responses
│   │   ├── palette.py          # PaletteColor, Palette
│   │   ├── quantize.py         # QuantizeAlgorithm, QuantizeResponse
│   │   ├── svg.py              # SvgEditResponse, ColorChangeModel
│   │   ├── system.py           # HealthResponse, LimitsResponse
│   │   └── vectorize.py        # TracingMode, Stacking, VectorizeResponse
│   └── services/
│       ├── pipeline.py         # orchestration reused by routes (decode → quantize → encode)
│       ├── image_io.py         # decode, validate, normalize, encode indexed PNG
│       ├── quantization.py     # kmeans / median-cut → (label_map, palette)
│       ├── vectorization.py    # label_map + palette → raw SVG (vtracer)
│       ├── svg_postprocess.py  # sanitize, group per color, add ids / data attrs
│       ├── svg_geometry.py     # parse contract SVG, flatten curves, polygons (exports)
│       ├── svg_edit.py         # serialize contract SVG, merge similar, recolor (/svg/*)
│       ├── model_options.py    # StlOptions, Body, layer snapping (shared by 3D exports)
│       ├── export_stl.py       # SVG → STL (heights, parts, 3D bodies)
│       ├── mixed_colors.py     # filament stacks of mixed colors → bodies
│       ├── mesh.py             # closed prisms, manifold fixes, binary STL
│       ├── base_plate.py       # plate outline, rim, hanging loop, magnet pocket, detail filter
│       ├── export_3mf.py       # SVG → 3MF (one colored part per color)
│       ├── tiles.py            # model larger than the bed → 3MF per tile
│       ├── filament_plan.py    # filament changes for single-extruder printers
│       ├── print_check.py      # shapes narrower than the nozzle
│       ├── color_changes.py    # changes, purge and filament use of multi-color printers
│       ├── lithophane.py       # image → lithophane STL
│       ├── export_dxf.py       # SVG → DXF (outlines per color layer)
│       ├── export_pdf.py       # SVG → PDF (exact curves)
│       └── export_eps.py       # SVG → EPS (exact curves)
└── tests/
    ├── conftest.py             # fixtures: TestClient, sample images
    ├── services/               # unit tests per service
    └── api/                    # endpoint tests
```

## Configuration

All settings are read from environment variables prefixed with `VECTORSNAP_`
(see [`.env.example`](../.env.example)).

| Variable | Default | Description |
|----------|---------|-------------|
| `VECTORSNAP_ENV` | `development` | `development` / `production` — controls docs exposure and log format |
| `VECTORSNAP_LOG_LEVEL` | `info` | Python log level |
| `VECTORSNAP_MAX_UPLOAD_MB` | `10` | Max request file size |
| `VECTORSNAP_MAX_IMAGE_DIMENSION` | `4096` | Max width/height in pixels |
| `VECTORSNAP_MIN_COLORS` | `2` | Lower bound for `colors` |
| `VECTORSNAP_MAX_COLORS` | `64` | Upper bound for `colors` |
| `VECTORSNAP_CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `UVICORN_WORKERS` | `1` | Worker processes in the container |

## Error handling

Domain errors are raised as subclasses of `VectorSnapError` and converted by a global
exception handler into a uniform JSON body:

```json
{
  "error": {
    "code": "IMAGE_TOO_LARGE",
    "message": "Image dimensions 6000x4000 exceed the limit of 4096 px.",
    "details": {"max_dimension": 4096}
  },
  "request_id": "b6c1f0d2-..."
}
```

| Exception | HTTP | `code` |
|-----------|------|--------|
| `UnsupportedMediaType` | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| `FileTooLarge` | 413 | `FILE_TOO_LARGE` |
| `ImageTooLarge` | 422 | `IMAGE_TOO_LARGE` |
| `InvalidImage` | 422 | `INVALID_IMAGE` |
| `InvalidParameters` | 422 | `INVALID_PARAMETERS` |
| `ProcessingError` | 500 | `PROCESSING_ERROR` |
| FastAPI `RequestValidationError` | 422 | `VALIDATION_ERROR` (`details.errors`: `loc`, `msg`, `type`; submitted input is never echoed) |

## Security considerations

- `PIL.Image.MAX_IMAGE_PIXELS` is set from the configured dimension limit to prevent
  decompression bombs.
- File type is detected from content (`Image.open(...).format`), not from the filename
  or `Content-Type` header.
- Uploads are read into memory with a hard byte limit; nothing is written to disk.
- Output SVG is rebuilt from scratch rather than filtered: only path geometry is taken
  from the tracer output (`svg`, `g`, `path`; attributes `d`, `fill`, `id`, `data-*`,
  `viewBox`, `width`, `height`). No scripts, event handlers, `<foreignObject>`, entities
  or external `href`s can appear.
- The container runs as a non-root user.

## Observability

- `GET /api/v1/health` — liveness (process up).
- `GET /api/v1/health/ready` — readiness (dependencies importable, thread pool available).
- Every request gets an `X-Request-ID` (taken from the incoming header or generated) that
  is echoed in the response and included in every log line.
- Logs (`app/core/logging.py`): one JSON object per line in production
  (`VECTORSNAP_ENV=production`: `time`, `level`, `logger`, `message`, `request_id` plus
  any extra fields), human-readable lines in development
  (`... INFO app.access [<request id>] POST /api/v1/quantize 200 duration_ms=812`).
  uvicorn's own logs go through the same handler; its access log is replaced by one
  `app.access` line per request with `method`, `path`, `status` and `duration_ms`
  (crashed requests are logged as `500`; health checks only at `debug` level).
- Processing steps (`app.services.pipeline`) log input dimensions, parameters and step
  durations under the same request id: `quantized image` (`colors`, `algorithm`,
  `decode_ms`, `quantize_ms`, ...), `vectorized image` (tracing options, `path_count`,
  `decode_ms` for an indexed PNG, `trace_ms`; one-shot requests log the quantizing as its
  own line first) and `suggested color count` (`decode_ms`, `suggest_ms`).
