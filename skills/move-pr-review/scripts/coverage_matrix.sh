#!/usr/bin/env bash
# Print a file × reviewer coverage matrix from reviewer JSON findings.
# Usage: coverage_matrix.sh <raw-dir> [<scope-files>]
#   <raw-dir>     defaults to reviews/.raw
#   <scope-files> defaults to <raw-dir>/_scope_files.txt
#
# For each in-scope file, prints:
#   file  R1  R2  R3  R4  R5  total
# Files with < 3 reviewer touches are flagged with "*" — leader should backfill.
#
# Requires: jq.

set -u
set -o pipefail

RAW_DIR="${1:-reviews/.raw}"
SCOPE_FILES="${2:-$RAW_DIR/_scope_files.txt}"
COVERAGE_FLOOR="${3:-5}"   # < this many reviewer touches → flag for leader backfill (default 5 of 10 = 50%)

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not found in PATH" >&2
  exit 2
fi
if [ ! -f "$SCOPE_FILES" ]; then
  echo "ERROR: scope file list not found: $SCOPE_FILES" >&2
  exit 2
fi

printf 'file\tR1\tR2\tR3\tR4\tR5\tR6\tR7\tR8\tR9\tR10\ttotal\tflag\n'

while IFS= read -r filepath || [ -n "$filepath" ]; do
  [ -z "$filepath" ] && continue
  total=0
  cells=()
  for n in 1 2 3 4 5 6 7 8 9 10; do
    src="$RAW_DIR/subagent-$n.json"
    if [ -f "$src" ]; then
      c=$(jq --arg fp "$filepath" '[.[] | select(.file == $fp)] | length' "$src" 2>/dev/null || echo 0)
    else
      c=0
    fi
    cells+=("$c")
    total=$((total + c))
  done
  touched=0
  for c in "${cells[@]}"; do [ "$c" -gt 0 ] && touched=$((touched + 1)); done
  flag=""
  if [ "$touched" -lt "$COVERAGE_FLOOR" ]; then flag="*"; fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$filepath" \
    "${cells[0]}" "${cells[1]}" "${cells[2]}" "${cells[3]}" "${cells[4]}" \
    "${cells[5]}" "${cells[6]}" "${cells[7]}" "${cells[8]}" "${cells[9]}" \
    "$total" "$flag"
done < "$SCOPE_FILES"

echo ""
echo "Files marked with * have < $COVERAGE_FLOOR reviewer touches out of 10 — orchestrator should backfill via R0 (leader)."
