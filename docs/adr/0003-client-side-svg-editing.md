# ADR 0003: Client-side SVG editing with Paper.js

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Users need to split vector shapes and recolor them interactively. Operations must feel
instant, and the backend must stay stateless.

## Decision

All editing happens in the browser using **Paper.js**, which provides SVG import/export,
hit-testing and boolean path operations (`intersect`, `subtract`, `unite`) needed for
splitting. The backend is not involved after `/vectorize`.

Alternatives: raw SVG DOM manipulation (no boolean ops), Fabric.js (no robust path
booleans), server-side editing (latency, requires session state).

## Consequences

- Editing works offline once the SVG is loaded.
- Server-side SVG operations for API consumers remain a future option (Roadmap).
- Export must normalize Paper.js output back to the VectorSnap SVG contract.
