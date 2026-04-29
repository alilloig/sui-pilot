#!/usr/bin/env bash
# evals/run-comparison.sh — run the eval suite against both v1 (main) and
# v2 (feat/v2-graph-port), then auto-invoke `claude -p` to score the delta.
#
# Usage:
#   bash evals/run-comparison.sh             # run all tasks, then score
#   bash evals/run-comparison.sh --no-score  # run, skip the scoring turn
#   bash evals/run-comparison.sh --v1-ref X --v2-ref Y   # custom refs
#
# Output:
#   evals/results/<UTC-timestamp>/{v1,v2}/<task-id>.{out,err,diff}
#   evals/results/<UTC-timestamp>/score.md   (markdown comparison report)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUI_PILOT_DIR="${SUI_PILOT_DIR:-$HOME/.claude/sui-pilot}"
TASKS_FILE="$SCRIPT_DIR/tasks.json"
COMPARE_PROMPT="$SCRIPT_DIR/compare-prompt.md"
RESULTS_DIR="$SCRIPT_DIR/results/$(date -u +%Y-%m-%dT%H-%M-%SZ)"

V1_REF="main"
V2_REF="feat/v2-graph-port"
SCORE=true

while [[ $# -gt 0 ]]; do
    case "$1" in
        --v1-ref)   V1_REF="$2"; shift 2 ;;
        --v2-ref)   V2_REF="$2"; shift 2 ;;
        --no-score) SCORE=false; shift ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

# ---- Pre-flight ----------------------------------------------------------
for cmd in claude jq git diff mktemp; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: '$cmd' not on PATH." >&2
        echo "       claude:  npm i -g @anthropic-ai/claude-code" >&2
        echo "       jq:      brew install jq" >&2
        exit 1
    fi
done

[[ -f "$TASKS_FILE" ]]    || { echo "ERROR: $TASKS_FILE missing" >&2; exit 1; }
[[ -d "$SUI_PILOT_DIR" ]] || { echo "ERROR: \$SUI_PILOT_DIR=$SUI_PILOT_DIR not a directory" >&2; exit 1; }

# Save the user's current branch so we can restore it on exit (success OR fail).
ORIGINAL_BRANCH=$(git -C "$SUI_PILOT_DIR" rev-parse --abbrev-ref HEAD)
trap 'echo "Restoring $SUI_PILOT_DIR to $ORIGINAL_BRANCH"; git -C "$SUI_PILOT_DIR" checkout "$ORIGINAL_BRANCH" >/dev/null 2>&1 || true' EXIT

mkdir -p "$RESULTS_DIR"
echo "Results directory: $RESULTS_DIR"

# ---- Run one version ----------------------------------------------------
run_one_version() {
    local version="$1"   # "v1" | "v2"
    local ref="$2"       # branch / tag / sha to checkout in $SUI_PILOT_DIR

    echo ""
    echo "=== [$version] Switching $SUI_PILOT_DIR to $ref ==="
    git -C "$SUI_PILOT_DIR" fetch origin "$ref" 2>&1 | tail -2 || true
    git -C "$SUI_PILOT_DIR" checkout "$ref" 2>&1 | tail -2
    git -C "$SUI_PILOT_DIR" pull --ff-only origin "$ref" 2>&1 | tail -2 || true
    git -C "$SUI_PILOT_DIR" rev-parse HEAD > "$RESULTS_DIR/$version.sha"

    mkdir -p "$RESULTS_DIR/$version"

    local n=$(jq 'length' "$TASKS_FILE")
    local i=0
    while IFS= read -r task; do
        i=$((i+1))
        local id=$(echo "$task" | jq -r .id)
        local fixture=$(echo "$task" | jq -r .fixturePath)
        local prompt=$(echo "$task" | jq -r .prompt)

        echo "[$version] [$i/$n] $id"

        local tmpdir
        tmpdir=$(mktemp -d -t "sui-pilot-eval.XXXXXX")
        # Copy fixture contents (using -a preserves perms; trailing /. copies hidden files).
        cp -a "$SCRIPT_DIR/$fixture/." "$tmpdir/"

        # Run claude -p in the fixture; capture stdout/stderr.
        # Set the project root explicitly so SessionStart profiler sees the right dir.
        (cd "$tmpdir" && CLAUDE_PROJECT_ROOT="$tmpdir" claude -p "$prompt") \
            > "$RESULTS_DIR/$version/$id.out" \
            2> "$RESULTS_DIR/$version/$id.err" || true

        # Diff post-state vs initial fixture (this is the canonical evidence
        # of what the model actually changed).
        diff -ruN "$SCRIPT_DIR/$fixture" "$tmpdir" \
            > "$RESULTS_DIR/$version/$id.diff" 2>/dev/null || true

        rm -rf "$tmpdir"
    done < <(jq -c '.[]' "$TASKS_FILE")
}

run_one_version "v1" "$V1_REF"
run_one_version "v2" "$V2_REF"

echo ""
echo "=== Eval runs complete ==="
echo "Results: $RESULTS_DIR"

# ---- Auto-score with Claude ---------------------------------------------
if [[ "$SCORE" == "true" ]]; then
    if [[ ! -f "$COMPARE_PROMPT" ]]; then
        echo "WARN: $COMPARE_PROMPT missing; skipping auto-score." >&2
    else
        echo ""
        echo "=== Scoring delta with claude -p ==="
        scoring_prompt=$(cat "$COMPARE_PROMPT")
        scoring_prompt="${scoring_prompt//RESULTS_DIR_PLACEHOLDER/$RESULTS_DIR}"
        scoring_prompt="${scoring_prompt//TASKS_FILE_PLACEHOLDER/$TASKS_FILE}"
        # Restore original branch BEFORE the scoring run so the scorer reads
        # whatever the user normally develops on (avoids confusion if v2 is buggy).
        git -C "$SUI_PILOT_DIR" checkout "$ORIGINAL_BRANCH" >/dev/null 2>&1 || true

        echo "$scoring_prompt" | claude -p "$(cat)" \
            | tee "$RESULTS_DIR/score.md"
        echo ""
        echo "Scored report: $RESULTS_DIR/score.md"
    fi
fi

echo ""
echo "Done."
