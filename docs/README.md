# VectorSnap Documentation

This directory contains the detailed specification of VectorSnap. Documents are
numbered in the recommended reading order.

| #  | Document | Contents |
|----|----------|----------|
| 01 | [Project overview](01-overview.md) | Goals, scope, glossary |
| 02 | [Requirements](02-requirements.md) | Functional and non-functional requirements with IDs |
| 03 | [Architecture](03-architecture.md) | System context, components, data flow |
| 04 | [Backend service](04-backend.md) | Module layout, configuration, error handling |
| 05 | [API specification](05-api-specification.md) | REST endpoints, payloads, error codes |
| 06 | [Image processing pipeline](06-image-processing-pipeline.md) | Preprocessing, quantization, vectorization |
| 07 | [Frontend application](07-frontend.md) | UI flow, components, state |
| 08 | [SVG editor](08-svg-editor.md) | Selecting, splitting and recoloring vector shapes |
| 09 | [Containerization](09-containerization.md) | Docker images, Compose, deployment notes |
| 10 | [Development workflow](10-development-workflow.md) | Branching, commits, code style, testing |
| 11 | [Roadmap](11-roadmap.md) | Milestones and future ideas |
| 12 | [Continuous integration](12-ci-cd.md) | GitHub Actions pipelines, path filters, commit checks, branch protection |
| —  | [ADR](adr/) | Architecture Decision Records |

## Conventions

- Requirement IDs: `FR-xx` (functional), `NFR-xx` (non-functional).
- "MUST", "SHOULD", "MAY" are used as defined in RFC 2119.
- Diagrams are written in Mermaid so they render directly on GitHub.
