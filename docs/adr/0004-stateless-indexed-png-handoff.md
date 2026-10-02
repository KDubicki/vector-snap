# ADR 0004: Stateless hand-off between quantize and vectorize via indexed PNG

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Vectorization must use exactly the quantization result the user saw and edited, but the
backend must not keep sessions (NFR-02).

## Decision

`/quantize` returns an indexed (palette-mode) PNG. The client sends it back to
`/vectorize` together with palette overrides. The PNG losslessly encodes the per-pixel
label map, so no recomputation or server-side storage is needed.

## Consequences

- One extra upload of a (small, highly compressible) PNG per vectorization.
- Palette edits are pure index → color remaps; merging colors is just assigning equal
  values to multiple indices.
- `/vectorize` additionally supports a one-shot mode for clients that don't need the
  intermediate step.
