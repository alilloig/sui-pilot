#!/usr/bin/env bash
# Smoke test for the three move-pr-review scripts.
# Usage: bash skills/move-pr-review/scripts/tests/smoke.sh
#
# Creates a throwaway .raw/ fixture, runs validate_schema.sh + coverage_matrix.sh
# + consolidate.js against it, and asserts on the key outputs. Prints PASS and
# exits 0 on success; prints FAIL: <reason> and exits 1 on any assertion failure.
#
# Requires: jq, node, awk (all standard on ubuntu-latest).

set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VALIDATE="$SCRIPT_DIR/validate_schema.sh"
COVERAGE="$SCRIPT_DIR/coverage_matrix.sh"
CONSOLIDATE="$SCRIPT_DIR/consolidate.js"

for f in "$VALIDATE" "$COVERAGE" "$CONSOLIDATE"; do
  if [ ! -f "$f" ]; then
    echo "FAIL: missing script: $f" >&2
    exit 1
  fi
done

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
RAW="$TMPDIR/.raw"
mkdir -p "$RAW"

cat > "$RAW/subagent-1.json" <<'EOF'
[
  {"id":"R1-001","title":"missing auth check","severity":"high","category":"access-control","file":"src/a.move","line_range":"10-15","description":"d","impact":"i","recommendation":"r","evidence":"e","confidence":"high"},
  {"id":"R1-002","title":"overflow in sum","severity":"medium","category":"arithmetic","file":"src/a.move","line_range":"40","description":"d","impact":"i","recommendation":"r","evidence":"e","confidence":"medium"},
  {"id":"R1-003","title":"no event on mint","severity":"low","category":"events","file":"src/b.move","line_range":"5","description":"d","impact":"i","recommendation":"r","evidence":"e","confidence":"low"}
]
EOF

cat > "$RAW/subagent-3.json" <<'EOF'
[
  {"id":"R3-001","title":"missing auth check","severity":"critical","category":"access-control","file":"src/a.move","line_range":"11-14","description":"d","impact":"i","recommendation":"r","evidence":"e","confidence":"high"}
]
EOF

cat > "$RAW/subagent-7.json" <<'EOF'
[
  {"id":"R7-001","title":"arithmetic overflow in sum","severity":"high","category":"arithmetic","file":"src/a.move","line_range":"38-42","description":"d","impact":"i","recommendation":"r","evidence":"e","confidence":"medium"}
]
EOF

printf 'src/a.move\nsrc/b.move\nsrc/c.move\n' > "$RAW/_scope_files.txt"

fail() { echo "FAIL: $1" >&2; exit 1; }

echo "[smoke] validate_schema.sh"
if ! bash "$VALIDATE" "$RAW" > "$TMPDIR/validate.out" 2>&1; then
  cat "$TMPDIR/validate.out" >&2
  fail "validate_schema.sh exited non-zero"
fi
grep -qE 'OK \(3 findings\)' "$TMPDIR/validate.out" || fail "validate_schema.sh: expected 'OK (3 findings)' for R1"
grep -qE 'OK \(1 findings\)' "$TMPDIR/validate.out" || fail "validate_schema.sh: expected 'OK (1 findings)' for singletons"

echo "[smoke] coverage_matrix.sh"
if ! bash "$COVERAGE" "$RAW" > "$TMPDIR/coverage.out" 2>&1; then
  cat "$TMPDIR/coverage.out" >&2
  fail "coverage_matrix.sh exited non-zero"
fi
expected_header=$'file\tR1\tR2\tR3\tR4\tR5\tR6\tR7\tR8\tR9\tR10\ttotal\tflag'
[ "$(head -1 "$TMPDIR/coverage.out")" = "$expected_header" ] \
  || fail "coverage_matrix.sh: header mismatch (got $(head -1 "$TMPDIR/coverage.out"))"
grep -qFx $'src/a.move\t2\t0\t1\t0\t0\t0\t1\t0\t0\t0\t4\t*' "$TMPDIR/coverage.out" \
  || fail "coverage_matrix.sh: expected src/a.move row with R1=2, R3=1, R7=1, total=4, flagged"
grep -qFx $'src/b.move\t1\t0\t0\t0\t0\t0\t0\t0\t0\t0\t1\t*' "$TMPDIR/coverage.out" \
  || fail "coverage_matrix.sh: expected src/b.move row with R1=1, total=1, flagged"
grep -qFx $'src/c.move\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t*' "$TMPDIR/coverage.out" \
  || fail "coverage_matrix.sh: expected src/c.move row with all zeros, flagged"

echo "[smoke] consolidate.js"
if ! node "$CONSOLIDATE" "$RAW" > "$TMPDIR/consolidate.out" 2>&1; then
  cat "$TMPDIR/consolidate.out" >&2
  fail "consolidate.js exited non-zero"
fi
grep -qE 'Raw findings: 5' "$TMPDIR/consolidate.out" || fail "consolidate.js: expected 'Raw findings: 5'"
grep -qE 'Clusters: 3' "$TMPDIR/consolidate.out" || fail "consolidate.js: expected 'Clusters: 3'"

CLUSTERS="$RAW/_consolidated.json"
[ -f "$CLUSTERS" ] || fail "consolidate.js: did not write _consolidated.json"
N_CLUSTERS=$(jq 'length' "$CLUSTERS")
[ "$N_CLUSTERS" = "3" ] || fail "_consolidated.json: expected 3 clusters, got $N_CLUSTERS"
N_CRITICAL=$(jq '[.[] | select(.max_severity == "critical")] | length' "$CLUSTERS")
[ "$N_CRITICAL" = "1" ] || fail "_consolidated.json: expected 1 critical cluster (from R3), got $N_CRITICAL"
CRITICAL_AGREEMENT=$(jq '[.[] | select(.max_severity == "critical")] | .[0].agreement_count' "$CLUSTERS")
[ "$CRITICAL_AGREEMENT" = "2" ] || fail "_consolidated.json: expected critical cluster agreement=2 (R1+R3), got $CRITICAL_AGREEMENT"

echo "[smoke] parameterization (REVIEWERS=7)"
REVIEWERS=7 bash "$COVERAGE" "$RAW" > "$TMPDIR/coverage7.out" 2>&1 \
  || fail "coverage_matrix.sh with REVIEWERS=7 exited non-zero"
expected_header7=$'file\tR1\tR2\tR3\tR4\tR5\tR6\tR7\ttotal\tflag'
[ "$(head -1 "$TMPDIR/coverage7.out")" = "$expected_header7" ] \
  || fail "coverage_matrix.sh with REVIEWERS=7: header should stop at R7 (got $(head -1 "$TMPDIR/coverage7.out"))"
grep -qE 'out of 7' "$TMPDIR/coverage7.out" \
  || fail "coverage_matrix.sh with REVIEWERS=7: footer should say 'out of 7'"

REVIEWERS=7 node "$CONSOLIDATE" "$RAW" > "$TMPDIR/consolidate7.out" 2>&1 \
  || fail "consolidate.js with REVIEWERS=7 exited non-zero"
grep -qE '/7 reviewers' "$TMPDIR/consolidate7.out" \
  || fail "consolidate.js with REVIEWERS=7: agreement lines should say '/7'"

echo "PASS"
