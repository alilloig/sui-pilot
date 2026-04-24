#!/usr/bin/env bash
# Strict JSON schema validation for reviewer findings.
# Usage: validate_schema.sh <raw-dir>
#   <raw-dir> defaults to reviews/.raw
#
# For each subagent-N.json (N in 1..10; 0 also accepted as leader backfill):
#   - asserts the top level is a JSON array
#   - asserts every element has the required fields with correct types
#   - asserts id matches "R<N>-NNN" pattern
#   - exits non-zero with detailed error if any reviewer fails
#
# Requires: jq.

set -u
set -o pipefail

RAW_DIR="${1:-reviews/.raw}"

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not found in PATH" >&2
  exit 2
fi

if [ ! -d "$RAW_DIR" ]; then
  echo "ERROR: directory not found: $RAW_DIR" >&2
  exit 2
fi

VALID_SEVERITIES='["critical","high","medium","low","info"]'
VALID_CONFIDENCE='["high","medium","low"]'
VALID_CATEGORIES='["access-control","correctness","arithmetic","object-model","versioning","integration-boundary","events","move-quality","testing","scripts","docs"]'

OVERALL=0

for n in 0 1 2 3 4 5 6 7 8 9 10; do
  f="$RAW_DIR/subagent-$n.json"
  [ -f "$f" ] || continue

  echo "=== validating subagent-$n.json ==="

  # Top-level must be an array
  if ! jq -e 'type == "array"' "$f" >/dev/null 2>&1; then
    echo "  FAIL: not a JSON array" >&2
    OVERALL=1
    continue
  fi

  # Per-element strict schema
  bad=$(jq --argjson sevs "$VALID_SEVERITIES" \
           --argjson confs "$VALID_CONFIDENCE" \
           --argjson cats "$VALID_CATEGORIES" \
           --arg ridprefix "R$n-" '
    [ .[] | select(
        (has("id") | not) or (.id | tostring | startswith($ridprefix) | not) or
        (has("title") | not) or (.title | type != "string") or (.title == "") or
        (has("severity") | not) or (.severity as $s | $sevs | index($s) == null) or
        (has("category") | not) or (.category as $c | $cats | index($c) == null) or
        (has("file") | not) or (.file | type != "string") or (.file == "") or
        (has("line_range") | not) or (.line_range | type != "string") or (.line_range == "") or
        (has("description") | not) or (.description | type != "string") or (.description == "") or
        (has("impact") | not) or (.impact | type != "string") or (.impact == "") or
        (has("recommendation") | not) or (.recommendation | type != "string") or (.recommendation == "") or
        (has("evidence") | not) or (.evidence | type != "string") or (.evidence == "") or
        (has("confidence") | not) or (.confidence as $c | $confs | index($c) == null)
      ) | .id // "<missing-id>"
    ]' "$f")

  bad_count=$(echo "$bad" | jq 'length')
  total=$(jq 'length' "$f")
  if [ "$bad_count" != "0" ]; then
    echo "  FAIL: $bad_count of $total entries failed schema check"
    echo "  Failing IDs: $bad"
    OVERALL=1
  else
    echo "  OK ($total findings)"
  fi
done

exit "$OVERALL"
