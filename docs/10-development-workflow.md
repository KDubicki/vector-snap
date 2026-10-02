# 10. Development Workflow

## Branching

- `main` is the integration branch and must always be releasable.
- Work happens on short-lived branches named `<type>/<short-description>`,
  e.g. `feat/palette-merge`, `fix/png-transparency`.
- Changes reach `main` through pull requests with passing CI and at least one review.

## Commit messages — Conventional Commits

Format:

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

| Type | Use for |
|------|---------|
| `feat` | New functionality |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `build` | Build system, dependencies, Docker |
| `ci` | CI configuration |
| `chore` | Maintenance tasks that don't touch src or tests |

Scopes: `backend`, `frontend`, `api`, `editor`, `docker`, `docs`, `adr`, `ci`, `deps`,
`deps-dev`, `release` (enforced by [`commitlint.config.mjs`](../commitlint.config.mjs)).

Commit messages are validated in CI and, optionally, locally by a `commit-msg` hook
(`make hooks`). See [CI — commit message checks](12-ci-cd.md#commit-message-checks).

Rules:

- Description in imperative mood, lower case, no trailing period, ≤ 72 characters
  (CI hard limit for the whole header: 100).
- Breaking changes: `!` after the type/scope and a `BREAKING CHANGE:` footer.
- All commit messages, code, comments and documentation are written in **English**.

Examples:

```
feat(backend): add median cut quantization algorithm
fix(editor): keep holes when splitting compound paths
docs(api): describe vectorize content negotiation
build(docker): run backend as non-root user
feat(api)!: rename `colors` to `palette_size`

BREAKING CHANGE: clients must send `palette_size` instead of `colors`.
```

## Versioning & releases

- Semantic Versioning, single version for the whole repository.
- Changelog generated from Conventional Commits (e.g. `release-please`, planned).

## Code style & quality gates

| Area | Tools | Command |
|------|-------|---------|
| Backend lint/format | ruff | `make lint-backend` |
| Backend types | mypy (strict on `app/services`) | `make typecheck-backend` |
| Backend tests | pytest, pytest-cov | `make test-backend` |
| Frontend lint/format | ESLint, Prettier | `make lint-frontend` |
| Frontend types | `tsc --noEmit` | `make typecheck-frontend` |
| Frontend tests | Vitest + V8 coverage | `make test-frontend` |
| Dockerfiles | hadolint (same version as CI) | `make lint-docker` |
| Everything above | | `make ci` |
| Full GitHub Actions workflow in containers | act | `make ci-act` |

## Testing strategy

- **Backend unit tests** — services tested with small synthetic images
  (e.g. 4-color checkerboard): quantization returns exactly N colors, determinism with a
  fixed seed, transparency excluded, SVG contains one group per color, sanitizer strips
  forbidden elements.
- **Backend API tests** — FastAPI `TestClient`: status codes, error envelope, limits,
  content negotiation.
- **Frontend unit tests** — palette editing logic, undo/redo commands, API client error
  mapping.
- **Editor geometry tests** — split produces shapes whose total area equals the original
  (within tolerance).
- **E2E (later)** — Playwright: upload → quantize → vectorize → split → download.

## Continuous integration

GitHub Actions runs path-filtered pipelines on every PR and push to `main`: backend
changes trigger only the backend pipeline, frontend changes only the frontend pipeline,
shared files trigger everything. Merges require the `CI result` and
`Conventional PR title` checks. PRs are squash-merged with the PR title as the commit
message.

Full description: [12-ci-cd.md](12-ci-cd.md).
