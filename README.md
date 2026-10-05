# VectorSnap

VectorSnap converts raster images (JPEG / PNG) into scalable vector graphics (SVG).
Before vectorization the image can be reduced to a chosen number of colors, and the
resulting palette can be edited. Once the SVG is generated, individual vector shapes
can be split into smaller pieces and recolored directly in the browser.

The project is split into two independent services:

| Service    | Stack                                            | Purpose                                                    |
|------------|--------------------------------------------------|------------------------------------------------------------|
| `backend`  | Python 3.12, FastAPI, Pillow, NumPy, scikit-learn, vtracer | Stateless image-processing API, usable as a standalone microservice |
| `frontend` | React, TypeScript, Vite, Paper.js                | Web UI: upload, palette selection/editing, SVG editor      |

Both services are containerized and orchestrated with Docker Compose.

## Features

- Upload JPEG / PNG images
- Reduce the image to a selected number of colors (color quantization)
- Preview and edit the generated palette before vectorization
- Convert the (quantized) image to SVG
- Edit the SVG in the browser: select shapes, zoom and pan
- Split shapes with a knife line for fine-grained corrections
- Recolor individual shapes or whole palette groups, delete shapes, undo/redo
- Download the edited SVG
- Export to STL for 3D printing (color layers as relief), DXF for laser cutters/plotters
  and PDF for print

## Quick start

Requirements: Docker 24+ and Docker Compose v2.

```bash
cp .env.example .env
docker compose up --build
```

| URL                              | Description                    |
|----------------------------------|--------------------------------|
| http://localhost:8080            | Frontend                       |
| http://localhost:8000/docs       | Backend OpenAPI (Swagger UI)   |
| http://localhost:8000/api/v1/health | Backend health check        |

## Local development (without Docker)

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /api to http://localhost:8000
```

A `Makefile` at the repository root wraps the most common commands — run `make help`.

## Repository layout

```
vector-snap/
├── backend/            # FastAPI image-processing microservice
│   ├── app/
│   │   ├── api/        # HTTP layer (routers)
│   │   ├── core/       # Configuration, logging
│   │   ├── schemas/    # Pydantic request/response models
│   │   └── services/   # Quantization, vectorization, SVG utilities
│   └── tests/
├── frontend/           # React + Vite single-page application
│   └── src/
│       ├── api/        # Backend API client
│       ├── components/ # UI components
│       ├── types/      # Shared TypeScript types
│       └── styles/
├── docs/               # Detailed project documentation
├── scripts/            # CI and developer scripts (commitlint, smoke tests)
├── .github/            # GitHub Actions workflows, composite actions, Dependabot
├── docker-compose.yml
└── Makefile
```

## Documentation

Detailed documentation lives in [`docs/`](docs/README.md):

1. [Project overview](docs/01-overview.md)
2. [Requirements](docs/02-requirements.md)
3. [Architecture](docs/03-architecture.md)
4. [Backend service](docs/04-backend.md)
5. [API specification](docs/05-api-specification.md)
6. [Image processing pipeline](docs/06-image-processing-pipeline.md)
7. [Frontend application](docs/07-frontend.md)
8. [SVG editor](docs/08-svg-editor.md)
9. [Containerization](docs/09-containerization.md)
10. [Development workflow](docs/10-development-workflow.md)
11. [Roadmap](docs/11-roadmap.md)
12. [Continuous integration](docs/12-ci-cd.md)
13. [Export formats](docs/13-export-formats.md)
14. [Architecture Decision Records](docs/adr/)

## Continuous integration

GitHub Actions runs path-filtered pipelines: backend changes run the backend pipeline,
frontend changes run the frontend pipeline, shared files (e.g. `.gitignore`,
`docker-compose.yml`) run everything. Each pipeline covers linting, formatting, type
checking, tests with coverage thresholds, dependency audits and Docker image build +
smoke test. Commit messages and PR titles are validated with commitlint. A single
`CI result` check gates merges. Details: [docs/12-ci-cd.md](docs/12-ci-cd.md).

Run the same checks locally:

```bash
make ci             # lint, typecheck, tests (backend + frontend)
make lint-commits   # commit messages on your branch
```

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are
validated in CI. Enable the local commit-msg hook with `make hooks`.
See [Development workflow](docs/10-development-workflow.md) for details.
