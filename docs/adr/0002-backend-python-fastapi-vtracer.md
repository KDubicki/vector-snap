# ADR 0002: Python + FastAPI + vtracer for the backend

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The backend must perform color quantization and multi-color raster-to-vector tracing,
and be exposed as a reusable HTTP microservice.

Options considered for tracing:

| Option | Color support | Notes |
|--------|---------------|-------|
| Potrace | Monochrome only | Would require tracing each color layer separately and stacking results; GPL-2 license |
| ImageTracer (JS/Java) | Color | Slower, less maintained |
| **vtracer** | Color, native | Rust core with Python bindings, fast, MIT license, stacked/cutout modes |

## Decision

- **Python 3.12** for the rich imaging/numeric ecosystem (Pillow, NumPy, scikit-learn).
- **FastAPI** for async HTTP, Pydantic validation and automatic OpenAPI documentation.
- **vtracer** for vectorization, fed with pre-quantized images so the palette is fully
  controlled by VectorSnap.

## Consequences

- CPU-heavy work must run in a thread pool to avoid blocking the event loop.
- vtracer ships prebuilt wheels for common platforms; Docker image uses a glibc base
  (`python:3.12-slim`) to use them.
