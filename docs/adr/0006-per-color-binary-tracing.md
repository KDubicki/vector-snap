# ADR 0006: Trace each palette color as a binary layer

- **Status:** Accepted
- **Date:** 2026-10-03

## Context

[ADR 0002](0002-backend-python-fastapi-vtracer.md) chose vtracer and assumed its color
mode could be fed an already-quantized image. Testing showed that vtracer's hierarchical
color clustering merges small regions (2–3 px wide stripes, small details) into their
neighbours and emits **averaged colors** that are not in the palette — regardless of
`color_precision`, `layer_difference` or `filter_speckle`. That violates FR-21 (output
uses exactly the confirmed palette) and loses detail.

## Decision

Trace every color layer separately with vtracer's **binary** mode:

- `cutout`: mask = pixels of the layer's color → non-overlapping shapes.
- `stacked`: mask = pixels of the layer's color and all layers above it → layers extend
  under each other, avoiding seams.

Fill colors are taken from the palette, never from tracer output.

## Consequences

- Output colors are exactly the palette colors; small regions survive (subject only to
  the user's `filter_speckle`).
- N tracer invocations per image (N ≤ 64). Binary tracing is fast: 16 layers of a
  1024×1024 image take ≈0.3 s.
- In `cutout` + `spline` mode, adjacent regions are smoothed independently, which can
  leave hairline seams; `polygon` or `stacked` avoid them. A seam-free cutout mode
  (e.g. shared boundary simplification) is a future improvement.
