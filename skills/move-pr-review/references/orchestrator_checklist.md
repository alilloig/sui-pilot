# Orchestrator Checklist — bash-grade commands in order

> Quick reference for the orchestrator. The orchestrator is **the main Claude Code session**, not a spawned subagent. Every command below runs in the main session's working directory. Adapt paths to the actual repo.
>
> **If you are reading this from inside a spawned subagent, stop.** The skill's multi-agent dispatch requires the `Task` tool, which spawned subagents frequently lack. Go back to the main session and invoke `/move-pr-review` from there.

## Phase 0 — Preparation (sequential)

```bash
# 0.1 — Detect target
gh pr view --json number,baseRefName,headRefName,title,body,additions,deletions 2>/dev/null \
  || gh pr list --head "$(git branch --show-current)" --json number,baseRefName,title \
  || git diff --stat $(git merge-base HEAD origin/main)..HEAD

# 0.2 — Capture commit hashes
git rev-parse HEAD                      # HEAD of current repo
# For each git dep in Move.toml, capture local clone HEAD:
# (e.g.) git -C ~/workspace/<dep-name> rev-parse HEAD

# 0.3 — Optional: fetch design docs
# (use Linear MCP / Notion MCP / WebFetch as available)

# 0.4 — Scaffolding
mkdir -p reviews/.raw
printf '*\n!.gitignore\n' > reviews/.raw/.gitignore
git diff --name-only $(git merge-base HEAD origin/main)..HEAD > reviews/.raw/_scope_files.txt
# Write reviews/.raw/_context.md from references/context_bundle_template.md
# Write reviews/.raw/_reviewer_prompt.md from references/reviewer_prompt.md
# Write reviews/.raw/_consolidator_prompt.md from references/consolidator_prompt.md
```

## Phase 1 — Fan out (single assistant turn, 10 parallel Agent calls)

Each Agent call:
- `subagent_type: sui-pilot:sui-pilot-agent` (primary — fully-qualified plugin-namespaced). If not registered, try `sui-pilot-agent` (bare); if that also fails, halt and tell user to enable the sui-pilot plugin + reload.
- `run_in_background: true`
- prompt embeds: pointer to `_context.md` + pointer to `_reviewer_prompt.md` + reviewer number (1..10) + output path `reviews/.raw/subagent-<N>.json`

All 10 calls go in a SINGLE assistant message. Sequential dispatch breaks parallelism and balloons wall-clock 10×.

While reviewers run, orchestrator does its own private smoke-read on the most critical files and saves to `reviews/.raw/_leader_shortlist.md`.

## Phase 2 — Validation + clustering (after all 10 reviewers complete)

```bash
# 2.1 — Schema validate
bash "${CLAUDE_PLUGIN_ROOT}/skills/move-pr-review/scripts/validate_schema.sh" reviews/.raw/

# 2.2 — Coverage matrix (informational)
bash "${CLAUDE_PLUGIN_ROOT}/skills/move-pr-review/scripts/coverage_matrix.sh" reviews/.raw/

# 2.3 — Cluster
node "${CLAUDE_PLUGIN_ROOT}/skills/move-pr-review/scripts/consolidate.js" reviews/.raw/
# Output: reviews/.raw/_consolidated.json
```

If schema validation fails for one reviewer: dispatch a single re-run of just that reviewer with a schema-only correction prompt. If coverage matrix shows < 4 reviewer touches out of 10 for an in-scope file: orchestrator reads the file directly and emits any additional findings to `reviews/.raw/subagent-0.json` with `id` prefix `R0-`.

## Phase 3 — Consolidator dispatch (single Agent call, foreground)

- `subagent_type: sui-pilot:sui-pilot-agent` (same fallback chain as Phase 1)
- `run_in_background: false` (we want the result)
- prompt embeds: pointer to `_context.md`, `_consolidated.json`, all 10 `subagent-N.json` (+ optional `subagent-0.json`), `_consolidator_prompt.md`. Output path: `reviews/<TICKET-ID>-<feature>-review.md`.

## Phase 4 — Hand-off

```bash
# Confirm output
ls -la reviews/<TICKET-ID>-<feature>-review.md
wc -l reviews/<TICKET-ID>-<feature>-review.md

# Spot-check 2 random findings (orchestrator opens cited file, verifies evidence quote)
```

Print to user:
- Final file path
- Severity counts
- Top-3 risks (lifted from executive summary)
- Suggested next steps:
  - "Commit `reviews/<…>.md` to the branch."
  - "Post the executive summary as a PR comment via `gh pr comment <N> -F <…>`."
  - "Open follow-up issues for HIGH findings."

Do NOT auto-commit, auto-push, or auto-comment.
