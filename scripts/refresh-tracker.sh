#!/bin/sh
# Copies the real tracker (pa.js and its modules) into tracker/ and writes
# tracker/PINNED.txt with a checksum per file, so every run tests the same
# tracker until someone refreshes it on purpose.
#
# Usage: scripts/refresh-tracker.sh [path to the web app's tracker/src]
set -e
cd "$(dirname "$0")/.."
SRC="${1:-${TRACKER_SRC:-../../../analytics/web/tracker/src}}"
if [ ! -f "$SRC/pa.js" ]; then
  echo "No pa.js in $SRC. Pass the web app's tracker/src folder." >&2
  exit 1
fi

rm -f tracker/pa*.js
for file in "$SRC"/pa*.js; do
  cp "$file" tracker/
done

{
  echo "# The tracker files the mock collector serves, copied from the web app's tracker/src."
  echo "# Refresh with scripts/refresh-tracker.sh. Do not edit the copies by hand."
  echo "copied: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for file in tracker/pa*.js; do
    if command -v sha256sum >/dev/null 2>&1; then
      sum=$(sha256sum "$file" | cut -d' ' -f1)
    else
      sum=$(shasum -a 256 "$file" | cut -d' ' -f1)
    fi
    echo "sha256 $(basename "$file") $sum"
  done
} > tracker/PINNED.txt

cat tracker/PINNED.txt
