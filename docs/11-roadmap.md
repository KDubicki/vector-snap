# 11. Roadmap

## Milestone 0 — Project foundation ✅

- Repository structure, documentation, Docker skeleton.
- GitHub Actions CI: path-filtered backend/frontend pipelines, commitlint, Dependabot.

## Milestone 1 — Backend MVP

- [x] Image decoding, validation, normalization (FR-01, FR-03…FR-06)
- [x] k-means quantization with Lab color space, median cut, locked colors (FR-10…FR-12, FR-15…FR-17)
- [x] `/quantize` endpoint returning indexed PNG + palette
- [x] vtracer integration (per-color binary layers), `/vectorize` in indexed and one-shot mode (FR-20…FR-25)
- [x] SVG post-processing & sanitization
- [x] Error envelope, request ids
- [ ] Structured JSON logging with step durations
- [x] Unit + API tests

## Milestone 2 — Frontend MVP

- [x] Upload step with drag & drop, paste and client-side validation (FR-01, FR-02)
- [x] Palette step: color count, method, preview, palette editing with live canvas preview (FR-10, FR-13, FR-15)
- [x] Tracing options, vectorize call and SVG preview (FR-24)
- [x] Download (FR-39)

## Milestone 3 — SVG editor

- [x] Paper.js integration, select, zoom/pan (FR-30, FR-38)
- [x] Recolor shape / group (FR-33, FR-34)
- [x] Knife split (FR-31)
- [x] Undo/redo (FR-37), delete shapes (FR-36)
- [x] Export of the edited document in the SVG contract (FR-39)

## Milestone 4 — Polish

- [x] Lasso split (FR-32)
- [x] Merge shapes (FR-35), move shapes between color groups
- [x] Palette merge, algorithm choice, locked colors (FR-14…FR-16)
- [x] Advanced tracing options UI (FR-24)
- [x] Automatic color count suggestion (`POST /suggest-colors`, ΔE target + elbow)
- [x] Background removal: border-color detection, colors left out of tracing (`transparent`)
- [ ] docker-compose.dev.yml, Playwright E2E tests in CI
- [ ] Release workflow: changelog, version tags, image publishing to a registry

## Future ideas

- Asynchronous job API (`POST /jobs`, `GET /jobs/{id}`) with a Redis/RQ worker for
  large images and batch processing.
- Server-side SVG operations (`/svg/recolor`, `/svg/split`) so other services can edit
  SVGs without a browser.
- More export options: EPS. (Per-layer STL heights and lithophanes are done, see
  [13-export-formats.md](13-export-formats.md).)
- Generated TypeScript client from OpenAPI.
- Kubernetes manifests / Helm chart.
