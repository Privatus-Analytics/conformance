#!/bin/sh
# Runs ./run.sh for every package next to this repo that has an example/ folder,
# then prints a pass or fail table. Exits non-zero when any package fails.
#
#   ./run-all.sh            packages in ..
#   ./run-all.sh path/to/packages
set -u
cd "$(dirname "$0")"
ROOT="${1:-..}"
RESULTS=$(mktemp)
trap 'rm -f "$RESULTS"' EXIT
failed=0

for dockerfile in "$ROOT"/*/example/Dockerfile; do
  [ -f "$dockerfile" ] || continue
  dir=$(dirname "$(dirname "$dockerfile")")
  name=$(basename "$dir")
  [ "$name" = "conformance" ] && continue
  start=$(date +%s)
  ./run.sh "$dir" > "reports-$name.tmp" 2>&1
  status=$?
  seconds=$(( $(date +%s) - start ))
  mkdir -p "reports/$name"
  mv "reports-$name.tmp" "reports/$name/run.log"
  summary=$(grep -E '[0-9]+ (passed|failed|skipped|flaky|did not run)' "reports/$name/run.log" | sed 's/.*| *//' | tr -s ' ' | sed 's/^ //' | paste -sd ',' - | sed 's/,/, /g')
  if [ "$status" -eq 0 ]; then result=PASS; else result=FAIL; failed=1; fi
  printf '%s|%s|%ss|%s\n' "$name" "$result" "$seconds" "${summary:-see reports/$name/run.log}" >> "$RESULTS"
  echo "$name: $result"
done

echo
printf '%-14s %-6s %-7s %s\n' PACKAGE RESULT TIME TESTS
printf '%-14s %-6s %-7s %s\n' -------------- ------ ------- -----------------------------
while IFS='|' read -r name result seconds summary; do
  printf '%-14s %-6s %-7s %s\n' "$name" "$result" "$seconds" "$summary"
done < "$RESULTS"
[ -s "$RESULTS" ] || echo "(no package with example/Dockerfile under $ROOT)"
exit "$failed"
