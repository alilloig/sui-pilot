# Evaluating and iterating on the `move-pr-review` skill

This directory documents the process of creating, testing, and iterating on a Claude Code skill — using `move-pr-review` as a worked example. It's meant to be didactic: if you're new to skill creation or skill evaluation, read this first before adding your own test cases.

The [skill-creator](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/skill-creator) plugin provides the evaluation workflow; everything in this directory is the artifacts produced by running that workflow on this skill.

---

## TL;DR — the loop

```
┌─────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────────┐
│  Draft  │ → │ Define evals │ → │ Run + grade  │ → │ Review + iter │
│ SKILL.md│   │  evals.json  │   │ benchmark.md │   │  feedback.json│
└─────────┘   └──────────────┘   └──────────────┘   └──────┬────────┘
     ▲                                                      │
     └──────────────────────────────────────────────────────┘
```

Every iteration is one pass through the loop. The artifacts in `iteration-N/` are a snapshot of that pass. This skill had one full iteration (iter-1) captured here; iter-2 changes are documented in **Iteration 2 summary** below.

---

## What's in this directory

```
evals/
├── README.md                  ← this file
├── evals.json                 ← test case definitions (prompts + expected outputs)
└── iteration-1/               ← snapshot of the first full eval run
    ├── benchmark.md           ← aggregated stats (pass rate, time, tokens)
    ├── benchmark.json         ← machine-readable benchmark
    ├── feedback.json          ← human reviewer's per-run comments
    └── eval-1-se-hadron-pas-integration-pr8/
        ├── eval_metadata.json ← test case + assertions
        ├── with_skill/        ← run using move-pr-review
        │   ├── outputs/       ← produced artifacts (review MD + .raw/ pipeline)
        │   └── run-1/
        │       ├── grading.json   ← per-assertion pass/fail
        │       └── timing.json    ← wall-clock + tokens
        └── without_skill/     ← same prompt, no skill guidance (baseline)
            ├── outputs/
            └── run-1/
                ├── grading.json
                └── timing.json
```

---

## How skill evaluation works

### 1. Define test cases (`evals.json`)

Each eval has a realistic user prompt that should trigger the skill, plus an `expected_output` description and (optionally) assertions. Our test case (`eval_id: 1`) asks for an audit-readiness Move PR review on a real repo (`se-hadron` PR #8). See the full prompt in `evals.json`.

Good evals look like real user requests — not abstract "test X" phrasings. Some should include the specific hooks the skill's description promises to catch on ("review this Move PR", "multi-agent review", etc.) and some should deliberately phrase things the skill is NOT for (so you can check it doesn't over-trigger).

### 2. Run the eval — with-skill AND baseline in parallel

For each test case, the skill-creator harness spawns **two subagents** with the same prompt:

- `with_skill`: given the skill's path, told to follow its workflow.
- `without_skill`: no skill reference. Whatever the vanilla model does.

Both should run in the same turn (parallel) so timing is comparable.

Outputs go to a workspace directory structured like `eval-N-<name>/{with_skill,without_skill}/outputs/`.

### 3. Grade each run (`grading.json`)

Each run's outputs are checked against the assertions in `eval_metadata.json`. Assertions can be:

- **Deterministic** — "file X exists", "contains section Y", "pass schema validation".
- **Manual-review** — "evidence quotes are literal, not paraphrased" (graders inspect manually).

Deterministic assertions should dominate — they're reproducible across iterations and tell you when a change regresses.

### 4. Aggregate into a benchmark (`benchmark.md` + `benchmark.json`)

`python3 -m scripts.aggregate_benchmark <iteration-dir> --skill-name <skill>` computes mean/stddev for pass rate, time, tokens across the two configurations. See this iteration's `benchmark.md` for the table.

### 5. Launch the eval-viewer for qualitative review

`python3 <skill-creator>/eval-viewer/generate_review.py <iteration-dir>` starts a local HTTP server that lets a human click through each run side-by-side, read the outputs, and leave per-run feedback comments. Feedback saves to `feedback.json` when you click "Submit All Reviews".

The viewer renders `.md` outputs as real HTML (headings, tables, code blocks) — no raw-markdown eye strain. Toggle "View raw" on any file to see the underlying Markdown source.

### 6. Read the feedback, decide on iter-(N+1) changes

The human's written feedback in `feedback.json` is the richest signal. Quantitative scores flag regressions; qualitative comments tell you what to actually change in the skill.

---

## Iteration 1 — what this eval captured

**Test case:** the `se-hadron` phase-2 PAS integration PR (reviewed as consultants per Linear ticket SOLENG-653).

**Setup:**
- `with_skill`: general-purpose subagent pointed at `move-pr-review` SKILL.md, told to output to the workspace.
- `without_skill`: general-purpose subagent with no skill path, same prompt.

**Results** (see `iteration-1/benchmark.md`):

| Metric | with_skill | without_skill | Δ |
|---|---|---|---|
| Pass rate | 89% (8/9 assertions) | 33% (3/9 assertions) | +56 pp |
| Wall clock | ~21 min | ~10 min | +11 min |
| Tokens | 217 K | 150 K | +67 K |

The 89% pass rate came from the skill producing all the expected structured artifacts (5 reviewer JSONs, `_consolidated.json`, `_verification_notes.md`, `_context.md`, final Markdown report with the right sections). The 33% baseline improvised a similar-looking Markdown deliverable but with none of the strict-JSON pipeline — so most "produces X.json" assertions failed.

**Caveats worth naming (important for interpreting the numbers):**

1. **The `with_skill` subagent didn't actually dispatch the 5 reviewers.** Spawned subagents in this harness lack the `Task` tool, so it simulated the 5 reviewer roles sequentially as one reasoner playing multiple parts. The architecture was exercised; the independence wasn't.
2. **The `without_skill` baseline peeked at an existing review file** (`se-hadron/reviews/SOLENG-653-pas-integration-review.md` from a prior manual run) and used it as a comparison reference. That biases the baseline upward — a true cold-start baseline would be weaker than 33%.
3. **The test-case prompt itself encoded the multi-reviewer intent** ("5 parallel reviewers + 1 consolidator, all sui-pilot-agents"). The baseline was able to imitate the structure from the prompt alone. A tighter prompt ("just review this PR") would discriminate more.

Despite the caveats, the iteration DID validate:
- The skill's recipe is followable end-to-end.
- The bundled scripts (`consolidate.js`, `validate_schema.sh`, `coverage_matrix.sh`) work first-try.
- The strict JSON schema + clustering + verification pipeline produces a well-structured report.
- The skill triggers its own described concerns: mega-cluster splitting happened exactly as SKILL.md warned, and one false-positive critical (R5-001) was correctly rejected during the consolidator's verification pass.

**Human reviewer feedback** (`feedback.json`):

- "Agents tend to focus too much on the absence of tests. Worth flagging at the beginning, maybe with a plan for implementing test cases, but not creating several items on the review about testing. Same goes for dependencies versions."
- "Task subagent dispatch was unavailable in the orchestrator's runtime ... This means we have to use the main session as agent orchestrator, to be sure that most of the times it will be able to actually dispatch subagents in parallel."
- "H-5 seems quite important and wasn't found on the skill review ... I believe is worth increasing the quantity of subagents to 10 since this is a critical task, and to do some investigation to fix that not all of them are being created as sui-pilot-agents."

---

## Iteration 2 — changes informed by iter-1

Applied directly to the skill (no iter-2 artifacts are in this PR because the plugin-registration fixes make real multi-agent dispatch possible — iter-2 would need to be exercised from the main session to be meaningful, not from a spawned subagent).

1. **Main-session orchestration, mandatory.** New top-level section in SKILL.md: if the skill is invoked from a context without the `Task` tool, halt immediately. Simulation is forbidden — it defeats the whole point of independent reviewers.
2. **Reviewers bumped 5 → 10.** Scripts (`consolidate.js`, `validate_schema.sh`, `coverage_matrix.sh`) updated to handle up to 10. Coverage-backfill floor tightened to `< 5 of 10` (50%).
3. **Code-level findings only in the severity body.** Testing concerns get a dedicated `## Test & coverage plan` section (concrete test-implementation plan, not a gap list). Build / dep / bytecode concerns get `## Build reproducibility & ops`. Reviewers still tag findings with `category: testing` or `category: versioning`; the consolidator collapses them into the dedicated sections while preserving per-function detail for the plan.
4. **`sui-pilot:sui-pilot-agent` as the primary subagent type.** Doc-first rule enforced by the agent definition itself. Fallback chain: bare `sui-pilot-agent` → halt with a message asking to enable the plugin → `general-purpose` with reviewer-prompt-enforced doc-first (loud degradation note in methodology).
5. **Plugin registration fixed.** Involves three edits (documented in `CHANGELOG.md`): `enabledPlugins["sui-pilot@alilloig"]`, `extraKnownMarketplaces["alilloig"]`, and crucially `known_marketplaces.json` (the runtime registry — `extraKnownMarketplaces` alone isn't sufficient).

---

## Running your own iteration

From the sui-pilot repo root:

```bash
# 1. Update SKILL.md / references / scripts based on feedback
$EDITOR skills/move-pr-review/SKILL.md

# 2. Spawn with_skill and without_skill runs against an evals.json test case
# (use your preferred orchestration; this repo uses Claude Code's subagent harness)

# 3. Capture outputs + timing per run into the workspace
mkdir -p /tmp/move-pr-review-workspace/iteration-2/eval-1-<name>/{with_skill/{outputs,run-1},without_skill/{outputs,run-1}}

# 4. Grade each run (manually or via a grader subagent)
$EDITOR .../run-1/grading.json

# 5. Aggregate
python3 -m scripts.aggregate_benchmark /tmp/move-pr-review-workspace/iteration-2 \
    --skill-name move-pr-review

# 6. Launch the eval-viewer
python3 <skill-creator-path>/eval-viewer/generate_review.py \
    /tmp/move-pr-review-workspace/iteration-2 \
    --skill-name move-pr-review \
    --benchmark /tmp/move-pr-review-workspace/iteration-2/benchmark.json \
    --previous-workspace /tmp/move-pr-review-workspace/iteration-1

# 7. Review in the browser, leave feedback, click "Submit All Reviews"
```

Copy the resulting `iteration-2/` (minus any secrets or very large raw reviewer dumps) into this directory alongside `iteration-1/` when you're done.

---

## Reading this iteration's raw artifacts

A quick tour of the files under `iteration-1/eval-1-se-hadron-pas-integration-pr8/`:

### `with_skill/outputs/`

- `SOLENG-653-pas-integration-review.md` — the deliverable the skill produced. The structure the skill prescribes: headline, executive summary, severity tally, HIGH/MEDIUM/LOW/INFO findings, integration-boundary notes, methodology, postscript.
- `.raw/` — the intermediate pipeline:
  - `_context.md` — the shared bundle given to all reviewers (ticket meta, scope list, dep surface, Notion-sourced design spec, the strict JSON schema, severity rubric, the leader's "LEADS" pre-read).
  - `_reviewer_prompt.md` — the prompt each reviewer followed.
  - `_consolidator_prompt.md` — the prompt the consolidator followed.
  - `_leader_shortlist.md` — the orchestrator's private pre-read (NOT shared with reviewers during their runs; used for leader sanity-check in the verification pass).
  - `subagent-1.json` … `subagent-5.json` — each reviewer's strict-schema findings (40 + 30 + 30 + 34 + 33 = 167 raw findings across 5 reviewers in this iteration).
  - `subagent-0.json` — leader backfill (5 findings for under-covered files).
  - `_consolidated.json` — 58 clusters after `consolidate.js` ran: each cluster has agreement count, severity spread, categories, union of recommendations, longest evidence.
  - `_verification_notes.md` — the consolidator's adjudication log. Every cluster with max_severity ≥ high or disputed_severity=true or singleton-high gets re-read against source code. This is where the false-positive critical got rejected.

### `without_skill/outputs/`

- `REVIEW.md` — the baseline's deliverable. Notice how it imitates the prompt's multi-reviewer framing but has no strict JSON pipeline — the raw/ subdir contains markdown files, not schema-valid JSON.
- `raw/reviewer-{1..5}-*.md` — the baseline's ad-hoc per-lens review notes.
- `raw/consolidation-notes.md` — the baseline's ad-hoc merge notes.

The contrast is what the skill is actually buying you: a strict, machine-processable pipeline where clustering, validation, and cross-checking are reproducible via scripts; versus a free-form imitation that looks similar but can't be regression-tested.

---

## See also

- Top-level `SKILL.md` — the skill itself.
- `references/reviewer_prompt.md` — what each of the 10 reviewers is told.
- `references/consolidator_prompt.md` — what the consolidator is told.
- `references/finding_schema.md` — the strict JSON schema every reviewer emits against.
- `references/final_report_template.md` — the structure the consolidator's Markdown deliverable follows.
- `scripts/consolidate.js` — the clustering + deduplication logic.
- `scripts/validate_schema.sh` — per-reviewer JSON schema validator.
- `scripts/coverage_matrix.sh` — file × reviewer coverage matrix + backfill flagging.
