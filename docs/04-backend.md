# 04. Backend Service

## Technology stack

| Purpose | Library | Notes |
|---------|---------|-------|
| Web framework | FastAPI + Uvicorn | Async, automatic OpenAPI schema |
| Validation / settings | Pydantic v2, pydantic-settings | Env-based configuration |
| Image decoding | Pillow | JPEG, PNG, WebP, AVIF (animated: first frame), EXIF transpose, decompression-bomb guard |
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
│   │   ├── body_limit.py       # Refuse bodies over the upload limit before parsing them
│   │   ├── concurrency.py      # Processing slots: at most N POST requests at once
│   │   ├── config.py           # Settings (pydantic-settings, VECTORSNAP_* env vars)
│   │   ├── errors.py           # Domain exceptions + HTTP exception handlers
│   │   ├── logging.py          # Structured JSON logging, request-id middleware
│   │   └── security.py         # Security headers on API responses
│   ├── api/
│   │   ├── deps.py             # Shared dependencies (size-limited upload reading)
│   │   ├── export_forms.py     # Form dependencies of the exports (SVG, 3D, 3MF, colors left out)
│   │   ├── responses.py        # attachment(), SvgEditRoute (raw SVG with Accept: image/svg+xml)
│   │   ├── router.py           # Aggregates routers under /api/v1
│   │   └── routes/
│   │       ├── health.py       # /health, /health/ready, /limits
│   │       ├── export/         # /export/*, one router per topic
│   │       │   ├── models.py     # STL, STL parts, 3MF, tiles, lithophane, cookie cutter
│   │       │   ├── estimates.py  # model size, filament plan, color changes, print check
│   │       │   ├── drawings.py   # DXF, PDF, EPS, PNG, layers, palette
│   │       │   └── crafts.py     # sticker, stencil, coloring page
│   │       ├── quantize.py
│   │       ├── svg/            # /svg/*, the editor's tools on the server, one router per topic
│   │       │   ├── colors.py     # merge similar, recolor
│   │       │   ├── cuts.py       # split (knife), lasso
│   │       │   ├── shapes.py     # delete, merge, transform, simplify, offset, fill holes
│   │       │   ├── document.py   # crop, reorder
│   │       │   ├── info.py       # stats, validate
│   │       │   └── batch.py      # several edits in one request
│   │       └── vectorize.py
│   ├── schemas/
│   │   ├── errors.py           # ErrorResponse (the error envelope) and the errors per endpoint, for OpenAPI
│   │   ├── export.py           # export form parsers, filament plan / estimate responses
│   │   ├── palette.py          # PaletteColor, Palette
│   │   ├── quantize.py         # QuantizeAlgorithm, QuantizeResponse
│   │   ├── svg.py              # /svg/* responses, line and id parsers
│   │   ├── svg_batch.py        # /svg/batch steps (one model per edit)
│   │   ├── system.py           # HealthResponse, LimitsResponse
│   │   └── vectorize.py        # TracingMode, Stacking, VectorizeResponse
│   └── services/
│       ├── pipeline.py         # orchestration reused by routes (decode → quantize → encode)
│       ├── image_io.py         # decode, validate, normalize, encode indexed PNG
│       ├── quantization.py     # kmeans / median-cut / filaments → (label_map, palette)
│       ├── palette_cleanup.py  # smoothing, merging similar and small colors
│       ├── color_suggestion.py # how many colors an image needs (/suggest-colors)
│       ├── color_science.py    # sRGB → Lab, CIEDE2000, nearest color
│       ├── vectorization.py    # label_map + palette → raw SVG (vtracer)
│       ├── svg_postprocess.py  # sanitize, group per color, add ids / data attrs
│       ├── svg_geometry.py     # parse contract SVG, flatten curves, polygons (exports)
│       ├── svg_edit.py         # serialize contract SVG, merge similar, recolor (/svg/*)
│       ├── svg_document.py     # edit_shapes(): the loop every server-side edit shares
│       ├── svg_shapes.py       # delete and merge shapes, as the editor (/svg/delete, /svg/merge)
│       ├── svg_split.py        # knife and lasso cuts, as the editor (/svg/split, /svg/lasso)
│       ├── svg_transform.py    # move, scale, flip, rotate shapes, curves kept (/svg/transform)
│       ├── svg_crop.py         # crop the document to its shapes (/svg/crop)
│       ├── svg_reorder.py      # color layer order, given or sorted (/svg/reorder)
│       ├── svg_holes.py        # fill small empty holes, curves kept (/svg/fill-holes)
│       ├── svg_offset.py       # grow or shrink shapes: bleed, kerf (/svg/offset)
│       ├── svg_simplify.py     # fewer outline points within a tolerance (/svg/simplify)
│       ├── svg_validate.py     # contract check: errors and warnings (/svg/validate)
│       ├── svg_stats.py        # colors, shapes, coverage and specks of a document (/svg/stats)
│       ├── model_options.py    # StlOptions, Body, layer snapping (shared by 3D exports)
│       ├── model_parts.py      # color order, heights, parts per color and height, footprints
│       ├── model_checks.py     # option combinations a 3D model cannot be built with
│       ├── export_stl.py       # parts → 3D bodies (plate, colors, rim, outline), STL, ZIP
│       ├── mixed_colors.py     # filament stacks of mixed colors → bodies
│       ├── mesh.py             # closed prisms, manifold fixes, binary STL
│       ├── base_plate.py       # plate outline, rim, hanging loop, magnet pocket, detail filter
│       ├── export_3mf.py       # SVG → 3MF (one colored part per color)
│       ├── tiles.py            # model larger than the bed → 3MF per tile
│       ├── filament_plan.py    # filament changes for single-extruder printers
│       ├── print_check.py      # shapes narrower than the nozzle
│       ├── color_changes.py    # changes, purge and filament use of multi-color printers
│       ├── coloring_page.py    # SVG → coloring page / paint by numbers PDF
│       ├── cookie_cutter.py    # SVG silhouette → cookie cutter STL
│       ├── export_palette.py   # SVG colors → GPL, ASE, CSS, JSON palette
│       ├── sticker.py          # SVG → print-and-cut sticker (CutContour)
│       ├── stencil.py          # SVG → stencil sheet with bridges (SVG, DXF)
│       ├── lithophane.py       # image → lithophane STL
│       ├── export_layers.py    # SVG → ZIP of one SVG/DXF/PDF per color
│       ├── export_dxf.py       # SVG → DXF (outlines per color layer)
│       ├── export_pdf.py       # SVG → PDF (exact curves)
│       ├── export_eps.py       # SVG → EPS (exact curves)
│       └── export_png.py       # SVG → PNG (anti-aliased raster)
└── tests/
    ├── conftest.py             # fixtures: TestClient, sample images
    ├── services/               # unit tests per service
    └── api/                    # endpoint tests
```

## Configuration

All settings are read from environment variables prefixed with `VECTORSNAP_`
(see [`.env.example`](../.env.example)). A value the server cannot run with stops it
at start with an error naming the setting (`app/core/config.py`), instead of failing
requests later: a palette of more than 255 colors, `MIN_COLORS` above `MAX_COLORS`,
a limit of 0, an unknown log level, an origin that is not `scheme://host[:port]`.

| Variable | Default | Description |
|----------|---------|-------------|
| `VECTORSNAP_ENV` | `development` | `development` / `production` — controls docs exposure and log format |
| `VECTORSNAP_LOG_LEVEL` | `info` | `debug`, `info`, `warning`, `error` or `critical`, in any case |
| `VECTORSNAP_MAX_UPLOAD_MB` | `10` | Max request file size (at least 1) |
| `VECTORSNAP_MAX_IMAGE_DIMENSION` | `4096` | Max width/height in pixels |
| `VECTORSNAP_MIN_COLORS` | `2` | Lower bound for `colors` (at least 1) |
| `VECTORSNAP_MAX_COLORS` | `64` | Upper bound for `colors`, at most 255: a palette index is one byte and 255 marks transparent pixels |
| `VECTORSNAP_MAX_SVG_SHAPES` | `20000` | Shapes an uploaded SVG may hold (`/svg/*`, `/export/*`); more → `413 SVG_TOO_COMPLEX` |
| `VECTORSNAP_MAX_CONCURRENT_JOBS` | `4` | Processing (POST) requests a worker runs at once; more wait for a slot ([concurrency](#concurrency)) |
| `VECTORSNAP_QUEUE_TIMEOUT_S` | `30` | Seconds a request waits for a slot before `503 SERVER_BUSY`; `0` = answer at once |
| `VECTORSNAP_CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins, `scheme://host[:port]` or `*`; a trailing `/` (copied from the address bar) is dropped, as it would never match |
| `UVICORN_WORKERS` | `1` | Worker processes in the container |
| `UVICORN_TIMEOUT_GRACEFUL_SHUTDOWN` | `50` | Seconds requests in progress may take to finish once the container is stopped ([09](09-containerization.md)) |

## Error handling

Domain errors are raised as subclasses of `VectorSnapError` and converted by a global
exception handler into a uniform JSON body; validation errors and the HTTP errors of the
framework (unknown path or method, malformed body) get the same body, so every error a
client sees has a `code` and the `request_id`:

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
| `SvgTooComplex` | 413 | `SVG_TOO_COMPLEX` (more shapes than `max_svg_shapes`) |
| `ImageTooLarge` | 422 | `IMAGE_TOO_LARGE` |
| `InvalidImage` | 422 | `INVALID_IMAGE` |
| `InvalidParameters` | 422 | `INVALID_PARAMETERS` |
| `ProcessingError` | 500 | `PROCESSING_ERROR` |
| `ServerBusy` | 503 | `SERVER_BUSY` (no processing slot came free in time; `Retry-After` header) |
| FastAPI `RequestValidationError` | 422 | `VALIDATION_ERROR` (`details.errors`: `loc`, `msg`, `type`; submitted input is never echoed) |
| Starlette `HTTPException` | 404 | `NOT_FOUND` (no endpoint at the path; `details.path`) |
| Starlette `HTTPException` | 405 | `METHOD_NOT_ALLOWED` (`details.allowed` and the `Allow` header list the methods) |
| Starlette `HTTPException` | 400 | `BAD_REQUEST` (a body that is not valid multipart, more than 1000 fields, a field over 1 MB) |
| Any other exception (a bug) | 500 | `INTERNAL_ERROR` (a fixed message; the traceback is logged under the request id by `app.errors`) |

The OpenAPI schema describes this body as `ErrorResponse` (`app/schemas/errors.py`) for
every error status a processing endpoint can answer — 400, 413, 415 (endpoints taking an
image), 422, 500 and 503 — in place of FastAPI's default `HTTPValidationError`
(`{"detail": [...]}`), which this API never sends; a client generated from the schema
gets the right error type.

An exception no handler takes is answered by `UnhandledErrorMiddleware`
(`app/core/errors.py`), the innermost middleware, rather than by Starlette's plain-text
`Internal Server Error` page: the 500 then still carries the request id and CORS headers,
so the frontend can show it and a bug report can quote it, while the client sees no
internals.

## Security considerations

- `PIL.Image.MAX_IMAGE_PIXELS` is set from the configured dimension limit to prevent
  decompression bombs.
- File type is detected from content (`Image.open(...).format`), not from the filename
  or `Content-Type` header.
- Uploads are read into memory with a hard byte limit; nothing is written to disk.
  `BodySizeLimitMiddleware` (`app/core/body_limit.py`) refuses a body larger than
  `VECTORSNAP_MAX_UPLOAD_MB` plus 4 MB for the other form fields with `413 FILE_TOO_LARGE`
  before it is parsed: at once when its `Content-Length` says so, otherwise (a chunked
  body) as soon as the bytes received pass the limit. It also keeps file parts in memory
  up to that size (Starlette writes those over 1 MB to temporary files by default), so a
  read-only root file system works. The per-file check of `read_upload` still applies.
- Output SVG is rebuilt from scratch rather than filtered: only path geometry is taken
  from the tracer output (`svg`, `g`, `path`; attributes `d`, `fill`, `id`, `data-*`,
  `viewBox`, `width`, `height`). No scripts, event handlers, `<foreignObject>`, entities
  or external `href`s can appear.
- Every response under `/api/` carries `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox`
  (`app/core/security.py`): the API returns data and files, never pages, so a browser
  that opens a response — an SVG export in a tab, the answer to a form posted from
  another site — must not sniff it into HTML, run scripts in it or frame it. These hold
  when the backend is reached directly (port 8000) or by other services, not only
  behind nginx. The interactive docs (`/docs`, `/redoc`, `/openapi.json`) load scripts
  and are left out.
- The container runs as a non-root user.

## Concurrency

Every `POST` decodes an image or SVG and runs CPU and memory heavy work in the thread
pool: quantizing a 4096 px photo, tracing it, building a 3D model. Dozens of them at once
slow every one down and can run the container out of memory, so `ProcessingLimitMiddleware`
(`app/core/concurrency.py`) runs at most `VECTORSNAP_MAX_CONCURRENT_JOBS` of them at once
per worker process (with `UVICORN_WORKERS` workers, that many times more per container).
Further requests wait for a slot in arrival order, up to `VECTORSNAP_QUEUE_TIMEOUT_S`;
one that waited longer is answered `503 SERVER_BUSY` with `Retry-After: 5`, so the client
retries instead of piling up. `GET` requests (health checks, `/limits`) and CORS
preflights never wait. A client sending several requests together only sees the later
ones queue for a moment.

A waiting request is **read while it waits**: it starts at once when a slot frees, and a
client that disconnects meanwhile is noticed. Its request is then dropped instead of
processed for nobody: the frontend aborts a palette preview it no longer needs when a
slider moves on, and nginx closes the connection to the backend when the browser leaves.
The access log shows it as `499` (nginx's "client closed request", nobody receives it)
after a `client left while waiting for a processing slot` line. On uvicorn with one slot
and 4 s requests, a third request whose predecessor was aborted while queued finished
after 6 s instead of 10 s. A request that already holds a slot runs to its end: its
work in the thread pool cannot be stopped. Waiting bodies are held in memory, at most
`VECTORSNAP_MAX_UPLOAD_MB` plus 4 MB each; one over the limit is refused while it waits.

Size the limit to memory, not cores: quantizing or tracing a 4096 × 4096 image peaks at
about 1.2 GB, so the default of 4 can take some 5 GB at worst. Keep
`VECTORSNAP_QUEUE_TIMEOUT_S` plus the slowest request below the proxy timeout (nginx:
`proxy_read_timeout 120s`).

## Compression

`GZipMiddleware` (`app/main.py`) compresses responses of 1 KB and more when the request
accepts gzip, at level 6 (as small as level 9 on SVG and STL, in less time). A traced SVG
in its JSON envelope shrinks to about 40 %, a binary STL to about 20 %. Content that is
compressed already — PNG and other images, ZIP and 3MF — is skipped. nginx passes the
compressed responses through unchanged.

## Observability

- `GET /api/v1/health` — liveness (process up).
- `GET /api/v1/health/ready` — readiness, with the worker's processing load
  (`jobs`: `running`, `waiting`, `limit`; see [Concurrency](#concurrency)). It stays
  ready while every slot is busy, so a busy service queues requests instead of leaving
  the load balancer.
- Every request gets an `X-Request-ID` (taken from the incoming header or generated) that
  is echoed in the response and included in every log line. An incoming id is kept only
  when it is 1–128 characters of `A–Z a–z 0–9 . _ : -` (nginx's `$request_id`, a UUID, a
  trace id); anything else — spaces, quotes, `key=value` lookalikes, kilobytes of text —
  would land verbatim in every log line, so it is replaced by a new UUID.
- Logs (`app/core/logging.py`): one JSON object per line in production
  (`VECTORSNAP_ENV=production`: `time`, `level`, `logger`, `message`, `request_id` plus
  any extra fields), human-readable lines in development
  (`... INFO app.access [<request id>] POST /api/v1/quantize 200 duration_ms=812`).
  uvicorn's own logs go through the same handler; its access log is replaced by one
  `app.access` line per request with `method`, `path`, `status` and `duration_ms`, plus
  `queue_ms` for processing requests — how long they waited for a slot
  ([Concurrency](#concurrency)) — (crashed requests are logged as `500`; health checks
  only at `debug` level).
- Every response carries a `Server-Timing` header that browser developer tools show
  under *Timing*: `queue` (waiting for a processing slot), the pipeline steps the request
  ran — `decode`, `quantize`, `suggest`, `trace` — and `total`, in milliseconds, e.g.
  `queue;dur=0.1, decode;dur=12.0, quantize;dur=803.0, total;dur=845.2`. A step reports
  itself with `record_timing()` (`app/core/logging.py`), also from worker threads.
- Processing steps (`app.services.pipeline`) log input dimensions, parameters and step
  durations under the same request id: `quantized image` (`colors`, `algorithm`,
  `decode_ms`, `quantize_ms`, ...), `vectorized image` (tracing options, `path_count`,
  `decode_ms` for an indexed PNG, `trace_ms`; one-shot requests log the quantizing as its
  own line first) and `suggested color count` (`decode_ms`, `suggest_ms`).
