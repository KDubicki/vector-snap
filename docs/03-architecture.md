# 03. Architecture

## System context

```mermaid
flowchart LR
    user((User)) -->|HTTPS| fe[Frontend<br/>React SPA served by nginx]
    fe -->|/api/* reverse proxy| be[Backend<br/>FastAPI image-processing service]
    ext[Other clients /<br/>services] -->|HTTP JSON + multipart| be
```

The **frontend** is a static single-page application. In the containerized setup it is
served by nginx, which also reverse-proxies `/api/*` to the backend, so the browser
talks to a single origin (no CORS needed in production).

The **backend** is a stateless HTTP service. It knows nothing about the frontend and can
be called by any other client (CLI tools, other microservices, automation pipelines).

## Responsibilities

| Concern | Frontend | Backend |
|---------|:--------:|:-------:|
| File selection, drag & drop, preview | ✅ | |
| Input validation (type, size, dimensions) | basic (UX) | ✅ authoritative |
| Color quantization | | ✅ |
| Palette editing (choosing new colors) | ✅ | applies overrides |
| Live recolor preview of quantized image | ✅ (canvas, client-side) | |
| Vectorization (tracing) | | ✅ |
| SVG sanitization & normalization | | ✅ |
| Interactive SVG editing (select, split, recolor, undo) | ✅ (Paper.js) | |
| Export / download | ✅ | |

Interactive editing is done client-side on purpose: it needs sub-100 ms feedback and
operates on data already present in the browser. The backend stays focused on the
CPU-heavy, deterministic transformations.

## Stateless round trip

The backend never stores images. State that must survive between steps is carried by
the client:

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant B as Backend

    U->>F: select image, choose N colors
    F->>B: POST /api/v1/quantize (image, colors=N)
    B-->>F: indexed PNG (base64) + palette[N]
    F->>U: preview + palette editor
    U->>F: edit palette colors (client-side preview)
    F->>B: POST /api/v1/vectorize (indexed PNG, palette overrides)
    B-->>F: SVG document + metadata
    F->>U: SVG editor (select / split / recolor)
    U->>F: download
```

The quantized image is returned as an **indexed (palette-mode) PNG**. It is lossless and
encodes the per-pixel label map, so the vectorize step can reuse it exactly without
re-running quantization and without server-side sessions.

## Backend internal layers

```mermaid
flowchart TB
    subgraph api [api — HTTP layer]
        r1[routes/health.py]
        r2[routes/quantize.py]
        r3[routes/vectorize.py]
    end
    subgraph schemas [schemas — Pydantic models]
    end
    subgraph services [services — pure domain logic]
        s1[image_io.py<br/>decode / validate / normalize]
        s2[quantization.py]
        s3[vectorization.py]
        s4[svg_postprocess.py<br/>sanitize / group / annotate]
    end
    core[core — config, logging, errors]

    api --> schemas
    api --> services
    services --> core
    api --> core
```

Rules:

- `services` contain no FastAPI imports; they operate on NumPy arrays / bytes / strings
  and are unit-testable in isolation. This also makes it possible to reuse them from a
  CLI or a queue worker later.
- `api` translates HTTP to service calls and maps domain exceptions to HTTP errors.
- CPU-bound service calls are executed in a thread pool (`run_in_threadpool`) so the
  event loop stays responsive.

## Frontend internal layers

```mermaid
flowchart TB
    ui[components — React UI] --> state[state — store / undo history]
    ui --> editor[editor — Paper.js wrapper]
    state --> api[api — typed HTTP client]
    editor --> state
```

See [07-frontend.md](07-frontend.md) and [08-svg-editor.md](08-svg-editor.md).

## Scaling and deployment

- The backend is CPU-bound and stateless → scale horizontally behind any load balancer.
- Worker count per container is controlled with `UVICORN_WORKERS` (default: 1 per vCPU).
- The frontend is static files → can be served from any CDN/object storage instead of nginx.
- For very large images or batch jobs, an asynchronous job API backed by a queue is
  planned (see [Roadmap](11-roadmap.md)); the service layer is already decoupled for it.
