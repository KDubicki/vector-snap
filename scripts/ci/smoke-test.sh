#!/usr/bin/env bash
# Start a container from <image> and wait until its Docker HEALTHCHECK reports "healthy".
# Uses the healthcheck defined in the Dockerfile, so it works the same on GitHub runners,
# inside `act` and locally, and verifies the healthcheck itself. Prints container logs and
# fails if the container exits, becomes unhealthy, or doesn't become healthy in time.
#
# Usage: scripts/ci/smoke-test.sh <image> [extra docker run args...]
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <image> [docker run args...]" >&2
  exit 2
fi

image=$1
shift

timeout_seconds=${SMOKE_TIMEOUT:-60}
name="smoke-$(date +%s)-$$"

# shellcheck disable=SC2317  # invoked indirectly via trap
cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    echo "::group::Container logs ($name)"
    docker logs "$name" 2>&1 || true
    echo "::endgroup::"
    echo "::group::Healthcheck log ($name)"
    docker inspect --format '{{json .State.Health}}' "$name" 2>&1 || true
    echo "::endgroup::"
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

# Probe every 2s instead of the image's production interval to keep CI fast.
docker run --detach --name "$name" --health-interval 2s --health-start-period 0s "$@" "$image" >/dev/null

for _ in $(seq 1 "$timeout_seconds"); do
  state=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name")
  case "$state" in
    "running healthy")
      echo "Smoke test passed: $image is healthy"
      exit 0
      ;;
    *" none")
      echo "::error::$image defines no HEALTHCHECK"
      exit 1
      ;;
    "running unhealthy")
      echo "::error::$image reported unhealthy"
      exit 1
      ;;
    running*) ;;
    *)
      echo "::error::$image container stopped (state: $state)"
      exit 1
      ;;
  esac
  sleep 1
done

echo "::error::$image did not become healthy within ${timeout_seconds}s"
exit 1
