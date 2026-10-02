#!/usr/bin/env bash
# Lint commit messages against Conventional Commits (commitlint.config.mjs).
# Single entry point used by CI, the commit-msg hook and `make lint-commits`.
#
# Usage:
#   scripts/lint-commits.sh --from <ref> [--to <ref>]   # range of commits
#   scripts/lint-commits.sh --last                      # last commit only
#   scripts/lint-commits.sh --edit <file>               # commit-msg hook
#   echo "feat: message" | scripts/lint-commits.sh      # arbitrary text (e.g. PR title)
set -euo pipefail

# Bump both together; see docs/12-ci-cd.md#updating-tool-versions.
COMMITLINT_VERSION="21.2.3"

cd "$(git rev-parse --show-toplevel)"
exec npx --yes \
  -p "@commitlint/cli@${COMMITLINT_VERSION}" \
  -p "@commitlint/config-conventional@${COMMITLINT_VERSION}" \
  commitlint "$@"
