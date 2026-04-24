#!/usr/bin/env bash
# Print a file × reviewer coverage matrix from reviewer JSON findings.
# Usage: coverage_matrix.sh <raw-dir> [<scope-files>]
#   <raw-dir>     defaults to reviews/.raw
#   <scope-files> defaults to <raw-dir>/_scope_files.txt
#
# For each in-scope file, prints:
#   file  R1  R2  ... R<REVIEWERS>  total  flag
# Files with < COVERAGE_FLOOR reviewer touches are flagged with "*" — leader should backfill.
# Defaults: REVIEWERS=10, floor=5 of 10 (both overridable via env / $3).
#
# Requires: jq.

set -u
set -o pipefail

RAW_DIR="${1:-reviews/.raw}"
SCOPE_FILES="${2:-$RAW_DIR/_scope_files.txt}"
COVERAGE_FLOOR="${3:-5}"   # < this many reviewer touches → flag for leader backfill (default 5 of 10 = 50%)
REVIEWERS="${REVIEWERS:-10}"

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not found in PATH" >&2
  exit 2
fi
if [ ! -f "$SCOPE_FILES" ]; then
  echo "ERROR: scope file list not found: $SCOPE_FILES" >&2
  exit 2
fi

srcs=()
for n in $(seq 1 "$REVIEWERS"); do
  [ -f "$RAW_DIR/subagent-$n.json" ] && srcs+=("$RAW_DIR/subagent-$n.json")
done

{
  if [ "${#srcs[@]}" -gt 0 ]; then
    jq -r '
      (input_filename | capture("subagent-(?<n>[0-9]+)") | .n) as $rev
      | group_by(.file)[]
      | "C\t\($rev)\t\(.[0].file)\t\(length)"
    ' "${srcs[@]}"
  fi
  sed 's/^/F\t/' "$SCOPE_FILES"
} | awk -F'\t' -v floor="$COVERAGE_FLOOR" -v reviewers="$REVIEWERS" '
  BEGIN {
    OFS = "\t"
    header = "file"
    for (i = 1; i <= reviewers; i++) header = header OFS "R" i
    header = header OFS "total" OFS "flag"
    print header
  }
  $1 == "C" { counts[$3, $2] = $4; next }
  $1 == "F" && $2 != "" {
    fp = $2
    total = 0; touched = 0
    row = fp
    for (n = 1; n <= reviewers; n++) {
      c = (fp SUBSEP n) in counts ? counts[fp, n] : 0
      row = row OFS c
      total += c
      if (c > 0) touched++
    }
    flag = (touched < floor) ? "*" : ""
    print row, total, flag
  }
  END {
    print ""
    print "Files marked with * have < " floor " reviewer touches out of " reviewers " — orchestrator should backfill via R0 (leader)."
  }
'
