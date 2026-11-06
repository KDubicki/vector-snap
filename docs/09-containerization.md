# 09. Containerization

## Overview

```mermaid
flowchart LR
    browser((Browser)) -->|:8080| fe[frontend container<br/>nginx:alpine<br/>static SPA + /api proxy]
    fe -->|http://backend:8000| be[backend container<br/>python:3.12-slim<br/>uvicorn]
    client((Other services)) -->|:8000| be
```

| Service | Image base | Port (container → host) | Healthcheck |
|---------|------------|-------------------------|-------------|
| `backend` | `python:3.12-slim` | `8000 → 8000` | `GET /api/v1/health` |
| `frontend` | `node:24-alpine` (build) → `nginx:1.27-alpine` (runtime) | `80 → 8080` | `GET /` |

## Backend image (`backend/Dockerfile`)

Multi-stage build:

1. **builder** — installs dependencies into a virtualenv (`/opt/venv`) using
   `pyproject.toml`. Build tools are only present in this stage.
2. **runtime** — copies the virtualenv and the `app/` package, creates an unprivileged
   `app` user (referenced by numeric UID `1000` so Kubernetes `runAsNonRoot` can verify it), sets `PYTHONDONTWRITEBYTECODE=1`, `PYTHONUNBUFFERED=1`, and starts
   `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS}` with
   `exec`, so uvicorn is PID 1.

**Stopping.** Docker and Kubernetes send SIGTERM to PID 1. uvicorn then stops taking
requests and lets those in progress finish, for up to `UVICORN_TIMEOUT_GRACEFUL_SHUTDOWN`
seconds (50 by default), before it exits; with several workers it passes the signal on to
each. `docker-compose.yml` gives the backend `stop_grace_period: 60s`, so a deploy or
`docker compose down` no longer cuts a long export off after Docker's default 10 s. In
Kubernetes keep `terminationGracePeriodSeconds` (30 by default) above the timeout, or
lower the timeout. Before `exec`, the `sh -c` wrapper was PID 1: it took the SIGTERM and
exited, and the kernel killed uvicorn with every request in progress.

The backend image is self-contained and can be deployed without the frontend — this is
the "microservice" deployment mode.

## Frontend image (`frontend/Dockerfile`)

1. **build** — `npm ci && npm run build` producing `dist/`.
2. **runtime** — `nginx:alpine` serving `dist/` with `frontend/nginx.conf`:
   - SPA fallback (`try_files $uri /index.html`).
   - `location /api/` → `proxy_pass http://backend:8000` with
     `client_max_body_size` matching the backend upload limit.
   - Long-term caching for hashed assets, `no-cache` for `index.html`.
   - Security headers on the page and every file (`X-Content-Type-Options`,
     `Referrer-Policy` and a `Content-Security-Policy`: only the app's own scripts,
     styles and API calls, images also from `data:` and `blob:` URLs, no framing).
     `add_header_inherit merge` keeps them in locations that add a header of their
     own: nginx drops a server's `add_header` there by default, which left the page
     and its scripts (`Cache-Control`) without any. `/api/` turns them off, as the
     backend sends its own. When `VITE_API_BASE_URL` points to another origin, add
     that origin to `connect-src`. The stack smoke test in CI checks them. Walked
     through in Chromium (a large photo scaled down, the sample, palette preview,
     editor, fragments, compare view, PNG and STL exports, both 3D previews): no
     violations. The editor reads path data with paper.js `getPathData`, not
     `exportSVG`, which set an inline `style` on a detached element on every edit.

`VITE_API_BASE_URL` is a build-time variable (default `/api`). When the frontend is
deployed against a remote backend, pass it as a build arg.

## Docker Compose

`docker-compose.yml` at the repository root:

- `backend` — built from `./backend`, reads `.env`, healthcheck on `/api/v1/health`.
- `frontend` — built from `./frontend`, `depends_on: backend (service_healthy)`.
- Both on a private bridge network `vectorsnap`.

Common commands:

```bash
docker compose up --build          # build & start everything
docker compose up backend          # backend only (microservice mode)
docker compose logs -f backend
docker compose down
```

### Development override

`docker-compose.dev.yml` (planned) mounts source directories and runs
`uvicorn --reload` and `vite dev` for hot reload inside containers:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Resource guidelines

| Service | CPU | Memory | Notes |
|---------|-----|--------|-------|
| backend | 1–2 vCPU per worker | 512 MB–1 GB per worker | Memory scales with image size (4096² RGBA ≈ 64 MB + intermediate arrays) |
| frontend | 0.1 vCPU | 32 MB | Static files only |

## Production notes

- Put a TLS-terminating reverse proxy / ingress in front of the frontend.
- Run multiple backend replicas behind a load balancer; no sticky sessions needed.
- Images are tagged `vectorsnap-backend:<version>` / `vectorsnap-frontend:<version>`
  with `<version>` from the git tag; CI publishing to a registry is on the roadmap.
