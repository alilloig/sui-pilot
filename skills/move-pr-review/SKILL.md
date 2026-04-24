---
name: move-pr-review
description: |
  Multi-agent deep PR review for Sui Move packages. Orchestrates 11 sui-pilot-agent
  subagents — 10 parallel reviewers + 1 consolidator — to produce a high-confidence,
  evidence-backed Markdown review of a Move pull request. Each reviewer independently
  invokes /move-code-review and /move-code-quality, cross-checks integration
  boundaries against upstream Move dependencies, and emits strict-schema JSON
  findings. The consolidator clusters, deduplicates, verifies high-severity claims
  against the source code, and writes the final report.

  Use this skill whenever the user asks to "review this Move PR", "audit this Move
  pull request", "do a deep / multi-agent / team review of a Move package", "Move
  consultation", "pre-audit review of Move code", "security review of this PR",
  or wants a more rigorous PR review than a single /move-code-review pass would
  give. Also trigger on "review PR #N" or "review this branch" when the changes
  are predominantly Move (.move files in the diff). Even when the user does not
  explicitly say "multi-agent", default to this skill for any non-trivial Move PR
  review (≥ ~100 lines of Move diff or any new module) — the redundancy and
  verification pass meaningfully reduces false positives compared to a single
  reviewer pass.

  Do NOT use for: single-file syntax checks (use /move-code-quality), security
  reviews of an entire package without a PR scope (use /move-code-review), or
  pure off-chain TypeScript reviews (use the pr-review-toolkit instead).
---

# Move PR Review (multi-agent)

Orchestrate a 1-consolidator + 10-parallel-reviewer team of `sui-pilot-agent` subagents to deep-review a Move pull request. The output is a single Markdown file consolidating evidence-backed findings, ordered by severity and by reviewer agreement.

## CRITICAL — Where this skill must run

**Run this skill from the main Claude Code session.** Do NOT run it from within a spawned subagent. Spawned subagents routinely lack the `Task` tool, which means they cannot dispatch the 11 sub-subagents this skill depends on — they'll fall back to simulating the reviewers serially in a single agent, which defeats the redundancy and independence that make the workflow valuable.

If the skill is invoked from a context without the `Task` tool:

1. Stop immediately.
2. Tell the user: "This skill requires the `Task` tool to dispatch parallel reviewers. Please run `/move-pr-review` from the top-level session rather than from a spawned subagent."
3. Do not try to simulate the reviewers — the whole point is genuine independence. Simulation produces a skewed report (too conservative because a single reasoner shares blind spots across all its "lenses"; too aggressive at downgrading because the consolidator sees its own reasoning in every finding).

## Agent type — `sui-pilot:sui-pilot-agent` is load-bearing

All 11 dispatched subagents (10 reviewers + 1 consolidator) MUST use `subagent_type: sui-pilot:sui-pilot-agent` (the fully-qualified plugin-namespaced name). The agent definition enforces the **doc-first rule**: consult `${CLAUDE_PLUGIN_ROOT}/AGENTS.md` and the `.sui-docs/` / `.walrus-docs/` / `.seal-docs/` directories before reasoning about Sui / Move / Walrus / Seal. This is non-negotiable for accurate findings — Sui Move evolves rapidly and LLM training data goes stale fast.

Fallback chain if the primary name isn't registered in the current session:

1. Try `sui-pilot:sui-pilot-agent` (primary — the fully-qualified name other plugin-provided agents use).
2. Try `sui-pilot-agent` (bare name — some harnesses register plugin agents without the namespace prefix).
3. If both fail, halt and tell the user: "The sui-pilot plugin doesn't appear to be loaded in the current session. Please (a) verify `sui-pilot@alilloig` is `true` in `~/.claude/settings.json`'s `enabledPlugins`, (b) verify `alilloig` is in `extraKnownMarketplaces` pointing at the sui-pilot repo path, then (c) run `/reload-plugins` or restart the session."
4. `general-purpose` is a **last-resort fallback**, not a replacement. If you have to use it, the reviewer prompt's Step 2 still enforces the doc-first rule via explicit paths (see `references/reviewer_prompt.md`), and you MUST LOUDLY note the degradation in the final Markdown's methodology section — the doc-first enforcement is softer because it relies on the reviewer actually following the prompt rather than being baked into the subagent definition.

## Why this skill exists

A single `/move-code-review` pass is fast but produces variable-quality findings — some misses, some false positives. For PR review at audit-readiness quality (pre-mainnet, partner consultation, pre-audit), running 10 independent reviewers and consolidating with a verification pass:

- **Catches more issues.** Reviewers run independently; each run surfaces singletons (findings caught by only one reviewer) that a single pass would miss. Doubling the reviewer count from 5 to 10 materially reduces miss rate on subtle issues that don't replicate across many reasoners.
- **Reduces false positives.** The consolidator re-derives the threat path for every critical/high claim against the source code, downgrading or rejecting findings that don't survive scrutiny.
- **Produces a defensible artifact.** Severity counts, agreement counts, evidence quotes, and a methodology section ready to attach to the PR or share with a partner.

## When to invoke

Trigger this skill (don't ask the user to confirm — just dispatch it) when:
- The user says "review this Move PR", "audit this PR", "do a multi-agent review", "Move consultation", "pre-audit review", or anything similar.
- The user references a PR number/URL and the diff is predominantly `.move` files.
- The user asks for a "thorough" / "deep" / "team" review of a Move package.

For trivial PRs (< ~50 lines of Move diff, no new modules), suggest the user run `/move-code-review` instead — the multi-agent overhead isn't worth it.

## Workflow at a glance

```
Phase 0 — Preparation (orchestrator = main session, sequential, ~3 min)
   ├── Detect target (PR# > current branch vs main > working tree)
   ├── Capture commit hashes (target repo + any pinned Move deps)
   ├── Build context bundle (PR meta, scope list, dep surface, optional Notion)
   ├── Write reviewer prompt + consolidator prompt to workspace
   └── Set up reviews/.raw/ scaffolding + .gitignore

Phase 1 — Parallel reviewers (10 sui-pilot-agent in background, ~8-12 min each)
   └── Each reads context, runs /move-code-review + /move-code-quality, audits
       TypeScript scripts, cross-checks upstream calls, writes JSON findings.
       Dispatch ALL 10 in a SINGLE assistant turn as 10 parallel Agent tool calls
       with run_in_background=true. Do not dispatch them sequentially.

Phase 2 — Validation + clustering (orchestrator, ~1 min)
   ├── Strict-schema validate each subagent-N.json (N = 1..10)
   ├── Build coverage matrix (file × reviewer); flag <5-touches files
   ├── Run scripts/consolidate.js → _consolidated.json (clusters)
   └── Orchestrator reads its own private smoke-read for sanity comparison

Phase 3 — Consolidator (1 sui-pilot-agent, foreground, ~5-10 min)
   └── Reads context + raw findings + _consolidated.json. Verifies every
       critical/high/disputed/singleton-high cluster against the code. Writes
       the final Markdown review.

Phase 4 — Hand-off (orchestrator, ~30 sec)
   └── Print path, severity counts, top-3 risks. Offer next-step suggestions.
```

Total wall clock: ~25–40 minutes depending on PR size. The main session is the orchestrator throughout — do not delegate Phases 0, 2, or 4 to a subagent.

## Phase 0 — Preparation

### 0.1 Detect target

Run these checks in order; stop at the first that succeeds:

1. If user passed an explicit PR (#N or URL): use it. Run `gh pr view <N> --json baseRefName,headRefName,number,title,body,additions,deletions,commits`.
2. If `gh pr list --head $(git branch --show-current) --json number,baseRefName` returns a row: use that PR.
3. Diff `git diff --stat $(git merge-base HEAD origin/main)..HEAD` — if non-empty, treat as branch-vs-main.
4. Otherwise diff working tree against HEAD.

Capture: base ref, head ref, head commit hash, file list (`git diff --name-only`).

### 0.2 Detect Move dep pins

Read `Move.toml` and any sub-package `Move.toml`s. For each git dep, capture the `rev =` value. If any rev is a branch name (`main`, `master`, `dev`), flag it now — this becomes a HIGH finding in the final report.

For each git dep, if a local clone exists at `~/workspace/<repo>` or `${HOME}/workspace/<repo>`, capture its current `git rev-parse HEAD` so the consolidator can cite "reviewed against upstream @ <hash>".

### 0.3 Optional context fetch

If the PR body, branch name, or user input references:
- A Linear ticket (e.g. `SOLENG-123`, full Linear URL): fetch via `mcp__claude_ai_Linear__get_issue` if available.
- Notion page URLs: fetch via `mcp__claude_ai_Notion__notion-fetch` if available.
- Other design docs (Confluence, Google Docs, GitHub Issues): fetch via WebFetch / `gh issue view` as appropriate.

Distill each fetched doc to ≤ 60 lines of design intent / invariants / threat model. This becomes part of the context bundle.

If no MCPs available, skip and note the gap in the methodology section.

### 0.4 Write the workspace files

Create `reviews/.raw/` (gitignored) at the repo root and write:

- `reviews/.raw/.gitignore` — single line `*` plus `!.gitignore`.
- `reviews/.raw/_scope_files.txt` — `git diff --name-only` output.
- `reviews/.raw/_context.md` — see `references/context_bundle_template.md` for the structure. Include: ticket summary, PR metadata, in-scope/out-of-scope file lists, dep surface mapping, optional Notion excerpts, finding schema, severity rubric, and a "LEADS — confirm/refute/ignore" section with the orchestrator's pre-read suspicions (if any).
- `reviews/.raw/_reviewer_prompt.md` — copy of `references/reviewer_prompt.md` with the reviewer-number placeholder.
- `reviews/.raw/_consolidator_prompt.md` — copy of `references/consolidator_prompt.md`.

The `_context.md` file is the single source of truth shared by all 10 reviewers. Spend the time to make it comprehensive — cheap up-front, expensive to fix mid-fan-out.

## Phase 1 — Parallel reviewer fan-out

Dispatch **10** `sui-pilot-agent` subagents **in a single turn** (10 Agent tool calls in one assistant message), each with `run_in_background: true`. The prompts are identical except for the reviewer number (R1..R10) and the output path. Failing to dispatch them in a single turn serializes the work and loses the parallelism benefit.

Each prompt instructs the reviewer to:
1. Read `reviews/.raw/_context.md` and `reviews/.raw/_reviewer_prompt.md` completely first.
2. Invoke `move-code-review` skill on the in-scope Move files.
3. Invoke `move-code-quality` skill on the same files.
4. Manually review TypeScript / off-chain scripts in the diff.
5. Cross-check every Hadron → upstream-dep call against the upstream source.
6. Think adversarially about every `public` / `public(package)` function.
7. Emit strict-schema JSON findings to `reviews/.raw/subagent-<N>.json`.
8. Print a < 200-word human summary in the final turn.

See `references/reviewer_prompt.md` for the full reviewer instructions to embed in each Agent call.

**While reviewers run** (background), the orchestrator should do its own private smoke-read of the most critical changed files (the new modules + heavily-modified modules) and write its findings to `reviews/.raw/_leader_shortlist.md`. This gives an independent signal to sanity-check reviewer convergence in Phase 3. Don't share this list with the consolidator — the consolidator should derive its verdicts from raw evidence, not be anchored to the orchestrator's pre-read.

## Phase 2 — Validation + clustering

Once all 10 reviewers complete:

### 2.1 Strict schema validation

Run `scripts/validate_schema.sh reviews/.raw/`. It uses `jq` to assert every finding in every subagent-N.json matches the strict schema. If any reviewer's output fails, dispatch a single schema-only re-run of that one reviewer (point them at `references/finding_schema.md` and ask them to re-emit the same findings in valid form).

### 2.2 Coverage matrix

Print the file × reviewer matrix. If any in-scope file has < 5 touches out of 10 (i.e. fewer than half the reviewers looked at it), the orchestrator reads it directly and emits any additional findings as `R0-NNN` entries in `reviews/.raw/subagent-0.json`. This is the leader backfill — important for low-coverage scripts and minor changes that reviewers tend to skip.

### 2.3 Consolidation clustering

Run `scripts/consolidate.js`. It clusters findings by `(file, line-range overlap ±6, category)` with a title-similarity tie-breaker, computes per-cluster `agreement_count` (unique reviewers), `max_severity`, `min_severity`, and `disputed_severity` flag (true if max−min ≥ 2 levels). Output: `reviews/.raw/_consolidated.json`.

**Known limitation of position-based clustering:** when multiple distinct concerns land in the same line range, they get conflated into a single "mega-cluster". Your consolidator (Phase 3) handles this by splitting mega-clusters during verification — see `references/consolidator_prompt.md` for how to detect and split.

## Phase 3 — Consolidator dispatch

Dispatch 1 `sui-pilot-agent` subagent (foreground, not background) with the consolidator prompt. The consolidator:

1. Reads `_context.md`, `_consolidated.json`, and all 5 `subagent-N.json` files.
2. For every cluster with `max_severity ∈ {critical, high}` OR `disputed_severity = true` OR `agreement_count = 1 AND max_severity ≥ high`, opens the cited file at the cited lines (±30 lines context) and adjudicates: **confirm** / **downgrade** / **reject** / **split** (mega-cluster).
3. For confirmed critical/high findings, traces the call graph one hop up and one hop down to validate the impact claim.
4. For integration-boundary findings, opens the cited upstream file and confirms the function signature / semantics claim.
5. Writes `reviews/.raw/_verification_notes.md` documenting every adjudication.
6. Writes the final Markdown review at `reviews/<TICKET-ID>-<feature>-review.md` (or `reviews/<branch>-review.md` if no ticket) following the structure in `references/final_report_template.md`.

The consolidator MUST NOT trust reviewer-assigned severities for critical/high — re-derive them from the verification pass.

## Phase 4 — Hand-off

After the consolidator returns, the orchestrator:

1. Confirms the file exists and is non-empty.
2. Spot-checks 2 random findings — opens the cited file and verifies the evidence quote matches verbatim.
3. Prints a short summary to the user: file path, severity counts, top-3 risks (lifted from the executive summary).
4. Suggests next steps: commit the review file, post the executive summary as a PR comment via `gh pr comment`, open follow-up issues for the criticals/highs.

Do NOT auto-commit, auto-push, or auto-comment — leave those for the user.

## Report structure — what goes where

The final Markdown deliverable has a specific division of concerns. The consolidator **MUST** respect this — it has been observed that LLMs tend to file every testing gap and every infra concern as separate `HIGH` / `MEDIUM` findings, drowning the code findings in process noise. The following rules reverse that tendency:

### Code-level findings (the body of the report — `HIGH` / `MEDIUM` / `LOW` / `INFO`)

ONLY findings about the code's behaviour, correctness, design, or on-chain semantics belong in these severity-graded sections. Examples of what goes here:

- Authorization or RBAC gaps in a `public` function.
- Incorrect integration with an upstream Move dependency (wrong witness, wrong mutability, missing approval).
- State-corruption paths, missing checks, wrong error conditions.
- Whitelist / compliance logic bugs.
- Move 2024 idiom violations that affect semantics.

### Testing gaps → one dedicated section

Do NOT file individual `HIGH` / `MEDIUM` findings for "missing tests for function X" or "no test for edge case Y". Instead, surface testing as a single `## Test & coverage plan` section near the end of the report. That section contains:

1. **A single bullet in the executive summary** stating the test posture (e.g. "Zero Move tests for the new PAS paths — critical gap before audit").
2. **A concrete test-implementation plan** in the dedicated section: priority-ordered list of test scenarios (including happy-path, error-path, and adversarial scenarios), suggested test utilities (`test_scenario`, `tx_context::dummy`, mocked namespaces), and specific assertion targets.

Reviewers are encouraged to emit `category: testing` findings in their JSON (keep the raw signal for clustering). The consolidator collapses them into the Test & coverage plan section instead of surfacing them as individual report items.

### Build / dep / infra → one dedicated section

Do NOT file individual `HIGH` / `MEDIUM` findings for each dependency pin issue, bytecode regeneration concern, `Move.toml` edition, or build-reproducibility issue. Instead, surface them as a single `## Build reproducibility & ops` section. That section contains:

1. **A single bullet in the executive summary** if one or more infra issues rise to "block merge" (e.g. `rev = "main"` pins).
2. **A concrete ops checklist** in the dedicated section: each dep pin with its current value + recommended fix, each bytecode / generated-file regeneration gap with a proposed build script, each `Move.toml` setting that needs updating, etc.

Reviewers may still emit `category: scripts` or `category: versioning` findings at `low` / `info` severity for code-level issues in scripts (e.g. fragile object-ID extraction, missing null guards in SDK calls). Those stay in the main severity-graded body. But pin rotation, lockfile strategy, etc. consolidate into the ops section.

### Why this split matters

Testing and dep-pin concerns are real and important, but they're infrastructure decisions, not code-correctness findings. Mixing them into the severity-graded findings body dilutes the "code is broken" signal that the PR author and auditor most need to see. A report with 1 HIGH about a real authorization gap + 1 dedicated section on tests is much more actionable than a report with 4 HIGHs where 3 are different flavors of "you need more tests".

## Quality gates the orchestrator enforces

- **Schema conformance** — all 10 JSONs pass strict validation before clustering.
- **Coverage proof** — every in-scope file has ≥ 5 reviewer touches out of 10 (50%) OR a leader backfill.
- **Critical-finding reproduction** — for every `critical` finding in the final Markdown, the consolidator's verification note must describe the adversary path concretely (who attacks, what they call, what they gain). If they can't write it, the severity is wrong.
- **Report structure discipline** — NO testing findings in the severity-graded body (they go in the dedicated section). NO dep-pin / bytecode / Move.toml concerns in the severity-graded body (they go in the ops section). Orchestrator spot-checks this post-consolidator.
- **Evidence audit** — orchestrator spot-checks 2 random findings post-consolidator.
- **Reproducibility** — methodology section in the Markdown lists head commit hash, dep pin hashes, and tool versions.

## Read these references when you need them

- `references/reviewer_prompt.md` — full reviewer instructions (embed in each Agent dispatch).
- `references/consolidator_prompt.md` — full consolidator instructions (embed in the Phase 3 dispatch).
- `references/context_bundle_template.md` — structure for `_context.md`.
- `references/finding_schema.md` — strict JSON schema for findings + severity rubric.
- `references/final_report_template.md` — structure for the deliverable Markdown.
- `references/orchestrator_checklist.md` — bash-grade checklist of every command the orchestrator should run, in order.

## Related skills and commands

- `/move-code-review` — the security/architecture review skill that each reviewer invokes.
- `/move-code-quality` — the Move 2024 idiom checker that each reviewer invokes.
- `/move-tests` — useful as a follow-up if findings include `testing` category.
- `pr-review-toolkit:review-pr` — the generic (non-Move) PR review workflow that inspired this skill's pattern. Use that one for non-Move PRs.

## Things that have gone wrong before — protect against them

- **Mega-clustering by file position.** Multiple distinct concerns at the same line range get grouped. The consolidator's job is to split — see the consolidator prompt for the heuristic.
- **Singleton false-positives at critical/high severity.** The most dangerous failure mode of pure-redundancy reviewing. The consolidator must verify these against the code, not trust the reviewer's confidence rating.
- **Subagent collusion on the same wrong conclusion.** All 10 reviewers running the same skill on the same code may share a blind spot. The orchestrator's private smoke-read (Phase 1) is the counter-signal. If all 10 reviewers miss something the orchestrator caught in pre-read, file it as `R0-*` during Phase 2.2.
- **Notion / Linear / WebFetch unavailable mid-run.** Phase 0 fetches once and caches into `_context.md`. If unavailable, note the gap in the methodology section — don't silently skip.
- **Stale dep pins.** Capture the local `git rev-parse HEAD` of every Move dep at Phase 0.2 and embed in `_context.md`. The consolidator cites this hash in the methodology section.
- **Reviewer over-budget.** Default budget is ~30–45 minutes per reviewer. If a reviewer hangs past 60 minutes, kill it and proceed with 4 reviewers; note the gap.
