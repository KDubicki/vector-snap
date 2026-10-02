# ADR 0005: Path-filtered CI with reusable workflows and a single gate job

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The repository contains two independently deployable services. Running every check on
every change wastes CI time, but changes to shared files (`.gitignore`, Compose, CI
config) can affect both services. Branch protection must still reliably block merges
when something fails.

Options considered:

| Option | Problem |
|--------|---------|
| Separate workflows with `on.push.paths` filters | Skipped workflows never report a status, so they cannot be required checks — PRs touching only one side would be blocked forever, or checks are left optional |
| One workflow running everything | Simple, but slow and wasteful |
| **Orchestrator + `dorny/paths-filter` + reusable workflows + gate job** | Slightly more YAML |

## Decision

- `ci.yml` detects changed paths using rules in `.github/path-filters.yml` and calls
  `backend.yml` / `frontend.yml` (`workflow_call`) conditionally. A `shared` group
  forces all pipelines.
- A final `CI result` job (`if: always()`) succeeds only when every job succeeded or was
  skipped; it is the only required CI status check.
- Commit messages are validated with commitlint on every run; PR titles in a separate
  lightweight workflow (they become squash commits).

## Consequences

- Fast feedback: frontend-only PRs don't wait for the backend matrix, and vice versa.
- Branch protection needs only two required checks, which stay stable when jobs are
  added or renamed.
- Path rules must be maintained when new top-level directories are added (documented in
  `docs/12-ci-cd.md`).
