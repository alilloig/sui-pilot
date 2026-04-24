# Final Report Template — Markdown

> Skeleton for the consolidator's deliverable. Adapt to the specific PR. Replace `<…>` placeholders. The structure below mirrors a real published review (`reviews/SOLENG-653-pas-integration-review.md` in the se-hadron repo) so the format is battle-tested.

---

# `<Project Name>` — `<Feature Name>` Review

**Ticket:** [`<ID>` — `<title>`](`<linear-or-issue-url>`)
**PR:** [`<owner>/<repo>#<N> — <title>`](`<pr-url>`)
**Branch:** `<head-branch>` @ `<sha>`
**Upstream dep (read-only reference):** `<dep>` @ `<sha>`
**Review date:** `YYYY-MM-DD`
**Reviewers:** 1 orchestrator + 10 parallel sui-pilot-agent subagents + 1 consolidator
**Scope:** `<one-sentence scope>`. Pre-existing code is NOT reviewed here.

> **Headline:** `<Approve | Approve-with-changes | Block>`. `<one-sentence summary of the most important risks and what should be done about them>`.

---

## Executive summary

- **Posture:** `*<Approve | Approve-with-changes | Block>*`. `<one-sentence rationale>`.
- **Top 3 CODE risks:** (only code-level findings here — infra is in the sections below)
  1. `<H-X title — one-line consequence>`. See `[HIGH] H-X`.
  2. `<H-Y title>`. See `[HIGH] H-Y`.
  3. `<H-Z title>`. See `[HIGH] H-Z`.
- **Top 3 strengths:**
  1. `<short positive observation>`.
  2. `<…>`.
  3. `<…>`.
- **Tests:** `<one-sentence posture — e.g. "Zero Move tests for the new modules. See Test & coverage plan below.">`.
- **Build / dep / ops:** `<one-sentence posture — e.g. "Move.toml pins deps to rev=main; see Build reproducibility & ops.">` (omit bullet if nothing merge-blocking).
- **Spec drift:** `<one-sentence spec-vs-code drift note, if any>`.

---

## Severity tally (after leader verification)

| Severity | Count | Change from raw reviewer output |
|---|---|---|
| Critical | `<N>` | `<X claims downgraded/rejected after verification>` |
| High | `<N>` | `<changes from raw>` |
| Medium | `<N>` | `<…>` |
| Low | `<N>` | `<…>` |
| Info | `<N>` | `<…>` |
| Rejected | `<N>` | `<brief reason summary>` |

Raw reviewer output: `<total>` findings across 10 reviewers → `<N>` clusters → adjudicated to the distribution above. Full raw artifacts in `reviews/.raw/`.

---

## Findings

> **Scope of this section:** code-level findings only. Authorization, correctness, integration boundary, RBAC, state model, witnesses, object model, arithmetic. **Testing concerns are in the `## Test & coverage plan` section.** **Build / dep / bytecode / Move.toml concerns are in the `## Build reproducibility & ops` section.** This split keeps the code signal concentrated.

### HIGH

#### H-1 — `<title>`  (`<file>:<line-range>`)

**Cluster:** `C0XX`  **Agreement:** `N/10` (`R1`, `R3`, `R5`, `R7`)  **Confidence:** `high|medium|low`

**Description.** `<what is wrong / suspicious>`

**Impact.** `<concrete consequence — for criticals, name the attacker, the call sequence, what they gain>`

**Recommendation.** `<specific, actionable fix>`

**Evidence.**
```move
// <file>:<line-range>
<literal quote from file>
```

**Leader verification.** `<confirm / downgrade-from-X-because / split-from-mega-cluster — one or two sentences>`.

---

(Repeat per HIGH.)

### MEDIUM

(Same per-finding format. Compactor than HIGH if you have many — keep evidence terse.)

### LOW

Terser bundle. One-line per finding with cluster ID + title + file path. Group by category if helpful:

1. **L-1 — `<title>`** (`<C0XX>`, `<file>:<line>`). `<one-sentence summary>`.
2. **L-2 — `<title>`** (`<C0XX>`, `<file>:<line>`). `<one-sentence>`.
...

### INFO

Same as LOW.

---

## Integration-boundary notes

The review validated the following call sites against upstream `<dep>@<sha>`:

- ✅ `<dep>::<symbol>(<args>)` — signature matches; `<note>`.
- ✅ `<dep>::<symbol>` — `<note>`.
- ⚠️ `<dep>::<symbol>` — `<concern>; see <H-X | M-X>`.
- ...

---

## Test & coverage plan

> This section aggregates all testing concerns into a single implementation plan. Do NOT file individual severity-graded findings for "missing test for X" — collapse them here.

**Current posture.** `<one-paragraph: what tests exist today, what's covered, what's not>`.

**Suggested test-implementation plan** (priority-ordered):

1. **`<module>::<fn>`** — `<scenarios to test: happy path / error path / adversarial>`. Test utilities: `<e.g. test_scenario, dummy namespace, mock upstream>`. Suggested assertions: `<list>`.
2. **`<module>::<fn>`** — `<scenarios>`. Test utilities: `<list>`.
3. **Cross-module integration:** `<e.g. register → whitelist → mint → transfer happy path as one end-to-end test>`.

Run `/move-tests` to scaffold these. Target ≥ 80% branch coverage on the new modules before audit handoff.

## Build reproducibility & ops

> This section aggregates all build / dep-pin / bytecode / Move.toml / CI concerns. Do NOT file individual severity-graded findings for these.

**Current posture.** `<one-paragraph: dep pins, bytecode regen, Move.toml edition, CI checks>`.

**Suggested ops checklist** (priority-ordered):

- [ ] **Pin `<dep>` to a commit hash.** Current: `rev = "<branch>"`. Suggested: `rev = "<sha>"`. Update `Move.lock` alongside.
- [ ] **Add a bytecode regeneration script** at `<path>` that rebuilds `<bytecode-file>` from `<source>` and fails CI if they diverge.
- [ ] **Promote `Move.toml` edition** from `<current>` to `<stable>` once the ecosystem supports it.
- [ ] **Other ops items** as relevant.

If nothing merge-blocking: **"No build / reproducibility blockers identified."**

---

## Methodology

**Workflow.** 1 orchestrator (main session) + 10 parallel `sui-pilot-agent` reviewer subagents + 1 `sui-pilot-agent` consolidator subagent. All ten reviewers received the same context bundle (`reviews/.raw/_context.md`) and reviewer prompt (`reviews/.raw/_reviewer_prompt.md`). They worked independently.

**Subagent type actually used.** `sui-pilot-agent` (enforces doc-first rule: reads the embedded doc index in `${CLAUDE_PLUGIN_ROOT}/agents/sui-pilot-agent.md` and the `.sui-docs/` / `.walrus-docs/` / `.seal-docs/` / `.ts-sdk-docs/` trees before reasoning about Move). If a fallback (`sui-pilot:sui-pilot-agent` or `general-purpose`) was used, note which phases and why.

**Skills invoked per reviewer.** `move-code-review`, `move-code-quality`, plus manual review of off-chain scripts.

**Raw artifacts.** `reviews/.raw/subagent-1.json` … `subagent-10.json` (schema-validated, `<total>` total findings).

**Consolidation.** `reviews/.raw/_consolidated.json` — `<N>` clusters via `${CLAUDE_PLUGIN_ROOT}/skills/move-pr-review/scripts/consolidate.js`.

**Verification.** `reviews/.raw/_verification_notes.md` — leader adjudicated every cluster with `severity ≥ high` or `disputed_severity = true` or `singleton-high`.

**Quality gates met.**
- Schema validation: all 10 reviewer JSONs passed.
- Coverage matrix: every in-scope file received ≥ 5 reviewer touches out of 10 except `<list under-covered files and how they were backfilled>`.
- Critical-finding reproduction: `<count>` claims verified; `<count>` rejected/downgraded.
- Boundary spot-checks: `<list upstream files validated>`.

**Non-reproducibility caveats.**
- Upstream dep `<dep>` HEAD used for review: `<sha>` (local clone). `Move.toml` pinned `<rev>` at review time.
- Review run on working-tree state at HEAD `<sha>`.

**Tools.** Claude Code (`<model>`). Skills: `move-code-review`, `move-code-quality`, `move-pr-review` (this orchestrator). MCPs used (if any): `<list>`.

---

## Appendix A — Per-reviewer raw stats

| Reviewer | Total | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|---|
| R1 | `<n>` | `<n>` | `<n>` | `<n>` | `<n>` | `<n>` |
| R2 | ... | ... | ... | ... | ... | ... |
| R3 | ... | ... | ... | ... | ... | ... |
| R4 | ... | ... | ... | ... | ... | ... |
| R5 | ... | ... | ... | ... | ... | ... |
| R6 | ... | ... | ... | ... | ... | ... |
| R7 | ... | ... | ... | ... | ... | ... |
| R8 | ... | ... | ... | ... | ... | ... |
| R9 | ... | ... | ... | ... | ... | ... |
| R10 | ... | ... | ... | ... | ... | ... |
| **Total** | ... | ... | ... | ... | ... | ... |

## Appendix B — Cluster agreement distribution

| Reviewers agreeing | Clusters |
|---|---|
| 10 / 10 | `<n>` |
| 9 / 10 | `<n>` |
| 8 / 10 | `<n>` |
| 7 / 10 | `<n>` |
| 6 / 10 | `<n>` |
| 5 / 10 | `<n>` |
| 4 / 10 | `<n>` |
| 3 / 10 | `<n>` |
| 2 / 10 | `<n>` |
| 1 / 10 | `<n>` |
| **Total** | `<N>` |

## Appendix C — Coverage matrix

| File | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `<file>` | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

## Appendix D — Artifacts index

- `reviews/.raw/_context.md` — shared context bundle
- `reviews/.raw/_reviewer_prompt.md` — reviewer prompt template
- `reviews/.raw/_scope_files.txt` — `git diff --name-only` output
- `reviews/.raw/_leader_shortlist.md` — orchestrator's pre-read (private)
- `reviews/.raw/subagent-{1..10}.json` — strict-schema reviewer findings (plus optional subagent-0.json for leader backfill)
- `reviews/.raw/_consolidated.json` — clusters
- `reviews/.raw/_verification_notes.md` — consolidator adjudication log
- This file — `reviews/<TICKET-ID>-<feature>-review.md`

---

## Postscript — what the multi-agent workflow actually bought us

(4–6 short paragraphs. Honest reflection on this specific run. Suggested topics in order:)

**What pure redundancy bought us.** `<how many 10/10, 9/10, 8/10 clusters; high-confidence signal>`.

**What independent thinking bought us.** `<how many singletons survived verification; coverage that one reviewer would have missed>`.

**What leader verification caught.** `<critical or high false-positives that were rejected after re-deriving the threat path against source code>`.

**Where the workflow underperformed.** `<over-clustering by file position; mega-clusters needing splits; or other observed weaknesses on this run>`.

**Coverage near-misses.** `<files that nearly fell through the coverage floor; what the leader backfilled>`.

**Cost & wall-clock.** `<reviewer-minutes; consolidator-minutes; total>`.

**Net judgment.** `<is this PR audit-ready? what should the partner do next?>`.
