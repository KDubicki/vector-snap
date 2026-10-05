# ADR 0007: Export formats are produced by the backend

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Users need the result in formats beyond SVG: STL for 3D printing, DXF for cutting
machines, PDF for print. These need curve flattening, polygon booleans and robust
triangulation — mature in Python (Shapely/GEOS, svgelements), weak in the browser.

## Decision

- Conversions are backend endpoints `POST /api/v1/export/{format}` taking an SVG in the
  VectorSnap contract. The frontend sends the **edited** document; other services can
  convert any contract SVG (microservice goal, NFR-01).
- Shared parsing/flattening lives in `app/services/svg_geometry.py`; each format has its
  own service module.
- STL caps are triangulated with GEOS constrained Delaunay (`shapely>=2.1`). mapbox-earcut
  was tried first and dropped: on a real document it produced cap triangulations that left
  a 45-hole polygon non-watertight.

## Consequences

- One extra request per export; documents are small (KBs to a few MB).
- Exports are deterministic and unit-testable on mesh/geometry properties.
- New formats are a service module + route + an entry in the frontend format registry.
