#!/usr/bin/env bash
# Start a container from <image> and wait until <path> on <container-port> returns 2xx.
# Prints container logs and fails if the endpoint does not come up in time.
#
# Usage: scripts/ci/smoke-test.sh <image> <container-port> <path> [extra docker run args...]
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: $0 <image> <container-port> <path> [docker run args...]" >&2
  exit 2
fi

image=$1
container_port=$2
path=$3
shift 3

timeout_seconds=${SMOKE_TIMEOUT:-60}
name="smoke-$(date +%s)-$$"

# shellcheck disable=SC2317  # invoked indirectly via trap
cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    echo "::group::Container logs ($name)"
    docker logs "$name" 2>&1 || true
    echo "::endgroup::"
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

docker run --detach --name "$name" --publish "127.0.0.1::${container_port}" "$@" "$image" >/dev/null
host_port=$(docker port "$name" "${container_port}/tcp" | head -n1 | awk -F: '{print $NF}')
url="http://127.0.0.1:${host_port}${path}"

for _ in $(seq 1 "$timeout_seconds"); do
  if curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
    echo "Smoke test passed: $image responded on $path"
    exit 0
  fi
  sleep 1
done

echo "::error::Smoke test failed: $url did not respond within ${timeout_seconds}s"
exit 1
