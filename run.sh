#!/bin/sh
# Runs the conformance tests for one package, end to end, in Docker.
#
#   ./run.sh ../python
#
# Builds the package's example/Dockerfile (with the package folder as the
# build context), starts it next to the mock collector, runs the Playwright
# tests against it, then removes the containers and volumes. Exits non-zero
# when a test fails or anything does not start. Reports go to
# reports/<package>/ (html/, junit.xml, build.log, services.log).
set -u
cd "$(dirname "$0")"

if [ $# -ne 1 ]; then
  echo "usage: $0 <package-dir>" >&2
  exit 2
fi
if ! PACKAGE_DIR=$(cd "$1" 2>/dev/null && pwd); then
  echo "No such folder: $1" >&2
  exit 2
fi
if [ ! -f "$PACKAGE_DIR/example/Dockerfile" ]; then
  echo "$PACKAGE_DIR has no example/Dockerfile (see CONTRACT.md)" >&2
  exit 2
fi

NAME=$(basename "$PACKAGE_DIR")
SLUG=$(printf '%s' "$NAME" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-')
export PACKAGE_DIR
export COMPOSE_PROJECT_NAME="conformance-$SLUG"
export REPORT_DIR="$PWD/reports/$NAME"
rm -rf "$REPORT_DIR"
mkdir -p "$REPORT_DIR"

cleanup() {
  docker compose logs --no-color mock example-app > "$REPORT_DIR/services.log" 2>&1 || true
  docker compose down -v --remove-orphans > /dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "== $NAME: building the mock, the example app and the test runner"
if ! docker compose build > "$REPORT_DIR/build.log" 2>&1; then
  tail -n 40 "$REPORT_DIR/build.log"
  echo "== $NAME: BUILD FAILED (full log: $REPORT_DIR/build.log)"
  exit 1
fi

echo "== $NAME: running the tests"
docker compose up --no-color --attach tests --abort-on-container-exit --exit-code-from tests
status=$?

if [ "$status" -ne 0 ]; then
  docker compose logs --no-color --tail 40 example-app mock 2>&1 || true
  echo "== $NAME: FAILED (exit $status). Report: $REPORT_DIR/html/index.html"
else
  echo "== $NAME: PASSED"
fi
exit "$status"
