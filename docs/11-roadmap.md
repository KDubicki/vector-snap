# 11. Roadmap

## Milestone 0 — Project foundation ✅

- Repository structure, documentation, Docker skeleton, CI-ready tooling.

## Milestone 1 — Backend MVP

- [ ] Image decoding, validation, normalization (FR-01…FR-06)
- [ ] k-means quantization with Lab color space (FR-10…FR-12, FR-17)
- [ ] `/quantize` endpoint returning indexed PNG + palette
- [ ] vtracer integration, `/vectorize` in indexed and one-shot mode (FR-20…FR-25)
- [ ] SVG post-processing & sanitization
- [ ] Error envelope, request ids, structured logging
- [ ] Unit + API tests

## Milestone 2 — Frontend MVP

- [ ] Upload step with client-side validation
- [ ] Palette step: color count, preview, palette editing with live canvas preview (FR-13)
- [ ] Vectorize call and SVG preview
- [ ] Download

## Milestone 3 — SVG editor

- [ ] Paper.js integration, select, zoom/pan (FR-30, FR-38)
- [ ] Recolor shape / group (FR-33, FR-34)
- [ ] Knife split (FR-31)
- [ ] Undo/redo (FR-37)
- [ ] Export normalization (FR-39)

## Milestone 4 — Polish

- [ ] Lasso split, merge, delete (FR-32, FR-35, FR-36)
- [ ] Palette merge, algorithm choice, locked colors (FR-14…FR-16)
- [ ] Advanced tracing options UI (FR-24)
- [ ] CI pipeline, docker-compose.dev.yml, E2E tests

## Future ideas

- Asynchronous job API (`POST /jobs`, `GET /jobs/{id}`) with a Redis/RQ worker for
  large images and batch processing.
- Server-side SVG operations (`/svg/recolor`, `/svg/split`) so other services can edit
  SVGs without a browser.
- Automatic color count suggestion (elbow method / silhouette score).
- Background removal before tracing.
- Export to PDF / EPS / DXF (cutting plotters).
- Generated TypeScript client from OpenAPI.
- Kubernetes manifests / Helm chart.
