# 02. Requirements

Priority: **M** = must have (MVP), **S** = should have, **C** = could have.

## Functional requirements

### Image input

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | The user MUST be able to upload a JPEG or PNG image via file picker. | M |
| FR-02 | The user SHOULD be able to upload an image via drag & drop and clipboard paste. | S |
| FR-03 | The system MUST validate file type by content (magic bytes), not only by extension. | M |
| FR-04 | The system MUST reject files larger than the configured limit (default 10 MB) and images larger than the configured dimension (default 4096 px on the longer side). | M |
| FR-05 | PNG transparency MUST be preserved: fully transparent pixels are not traced. | M |
| FR-06 | The system SHOULD respect EXIF orientation for JPEG images. | S |

### Color reduction (quantization)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10 | The user MUST be able to choose the target number of colors (default range 2–64). | M |
| FR-11 | The system MUST return a preview of the quantized image together with its palette. | M |
| FR-12 | Each palette entry MUST include its index, hex color and pixel coverage percentage. | M |
| FR-13 | The user MUST be able to change any palette color (color picker / hex input) before vectorization. | M |
| FR-14 | The user SHOULD be able to merge two palette entries into one. | S |
| FR-15 | The user SHOULD be able to choose the quantization algorithm (k-means, median cut). | S |
| FR-16 | The user COULD lock specific colors (e.g. brand colors) that must appear in the palette. | C |
| FR-17 | Quantization MUST be deterministic for identical input and parameters (fixed random seed). | M |

### Vectorization

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-20 | The system MUST convert the (optionally quantized) image to SVG. | M |
| FR-21 | The SVG MUST use exactly the palette colors confirmed by the user. | M |
| FR-22 | Each output `<path>` MUST carry a stable `id` and a `data-palette-index` attribute. | M |
| FR-23 | Paths SHOULD be grouped per palette color (`<g data-palette-index="n">`). | S |
| FR-24 | The user SHOULD be able to tune tracing parameters: speckle filter size, corner threshold, curve mode (polygon / spline), path precision. | S |
| FR-25 | The output SVG MUST have a `viewBox` matching the source image dimensions. | M |

### SVG editing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-30 | The user MUST be able to select a single shape by clicking it. | M |
| FR-31 | The user MUST be able to split a selected shape into smaller shapes by drawing a cut line across it. | M |
| FR-32 | The user SHOULD be able to split a shape by drawing a polygon/lasso region (region becomes a new shape). | S |
| FR-33 | The user MUST be able to change the color of a selected shape. | M |
| FR-34 | The user MUST be able to change the color of an entire palette group at once. | M |
| FR-35 | The user SHOULD be able to merge adjacent shapes of the same color. | S |
| FR-36 | The user SHOULD be able to delete a shape. | S |
| FR-37 | The editor MUST support undo/redo for all editing operations. | M |
| FR-38 | The editor MUST support zoom and pan. | M |
| FR-39 | The user MUST be able to download the edited SVG. | M |

## Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | **Separation.** Frontend and backend MUST be separate deployable units communicating only over HTTP/JSON. |
| NFR-02 | **Statelessness.** The backend MUST NOT keep per-user state between requests; every request carries all data it needs. This allows horizontal scaling. |
| NFR-03 | **API stability.** The backend API MUST be versioned (`/api/v1`) and described by an OpenAPI schema. |
| NFR-04 | **Containerization.** Each service MUST have its own Dockerfile; the full stack MUST start with `docker compose up`. |
| NFR-05 | **Performance.** A 1024×1024 image reduced to 16 colors SHOULD be quantized in < 2 s and vectorized in < 5 s on a 2-vCPU container. |
| NFR-06 | **Security.** Uploaded files MUST be processed in memory or in an ephemeral temp dir and never served back verbatim; image decoding MUST guard against decompression bombs. Returned SVG MUST NOT contain scripts or external references. |
| NFR-07 | **Observability.** The backend MUST expose a health endpoint and emit structured (JSON) logs with request IDs. |
| NFR-08 | **Configurability.** Limits and CORS origins MUST be configurable via environment variables. |
| NFR-09 | **Browser support.** The frontend MUST work in the latest two versions of Chrome, Firefox, Safari and Edge. |
| NFR-10 | **Quality.** Backend code MUST pass `ruff` and `mypy`; frontend MUST pass `eslint` and `tsc`. Core services SHOULD have ≥ 80% unit test coverage. |
| NFR-11 | **Language.** Code, comments, commits and documentation MUST be in English. |
