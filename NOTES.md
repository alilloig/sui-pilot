# sui-pilot v2 — branch notes

> Human-readable record of what changed on `feat/v2-graph-port` and the
> eval framework introduced alongside it. The single canonical narrative
> for "why is this branch shaped the way it is" — everything else in this
> tree (README, CHANGELOG, evals/BASELINE.md, evals/README.md) is either
> user-facing surface, release notes, raw eval data, or operator manuals.
>
> Companion docs:
> - `evals/BASELINE.md` — raw per-run data, append-only history
> - `evals/README.md` — eval harness operator manual
> - `CHANGELOG.md` — release-note format
> - `README.md` — user-facing plugin docs

---

## 1. Origin story

This branch started from the hypothesis that `vercel.md` (in vercel-plugin) had deprecated the AGENTS.md pattern from Vercel's January 2026 blog post, driven by Claude Code's 1M context window making strict pipe-delimited indexing "overkill." The goal was to port the new approach to sui-pilot for a state-of-the-art revision.

Research found this hypothesis **false but directionally productive**:

- Pipe-delimited indexing wasn't deprecated by 1M context — it was deprecated by **direct doc co-location**. Next.js 16.2 ships docs inside `node_modules/next/dist/docs/` and AGENTS.md collapses to a one-line pointer.
- `vercel.md` is **not** AGENTS.md's successor — it's a complementary plugin-internal layer ("Ecosystem graph") that Vercel ships *alongside* AGENTS.md.
- The 1M context window is real (Anthropic GA'd it 2026-03-13) but **not load-bearing** for the design — vercel-plugin still enforces strict byte budgets and dedup.

What this meant for sui-pilot: the slim-preamble + bundled-docs + curated-graph + targeted-injection architecture is the actual state-of-the-art, and was worth porting. So the branch ported it.

---

## 2. What got tried — `v2-graph-port` (the full Vercel transplant)

Three layers landed on this branch in early commits (`41d5a5c` and below):

1. **Slim always-loaded preamble** — `agents/sui-pilot-agent.md` collapsed from a 19.4 KB pipe-delimited file index to a 2.9 KB topic-routing table. The agent navigates `.<source>-docs/` directly via `Glob`/`Grep` instead of reading a precomputed index.

2. **Ecosystem graph** — a new `sui.md` (445 lines, 13 sections) modeled on `vercel.md`, with `⤳ skill:` markers and `→ depends on` edges. Co-injected per matched skill via a chunk-extraction mechanism.

3. **Hooks pipeline** — ported wholesale from `vercel-plugin/hooks/src/*.mts`. A SessionStart profiler, a PreToolUse path/bash/import matcher, a UserPromptSubmit prompt scorer, byte budgets, dedup, a `/sui-pilot-doctor` health check, a `scripts/build-manifest.ts` step that precompiled `skills/*/SKILL.md` frontmatter into `generated/skill-manifest.json`. ~7,500 LOC of `.mts` source / ~15 K LOC including compiled `.mjs`.

(Doc co-location layer was already in place from v1 — `.sui-docs/`, `.move-book-docs/`, `.walrus-docs/`, `.seal-docs/`, `.ts-sdk-docs/` — no changes.)

---

## 3. What the evals revealed — precut baseline (2026-04-30)

To validate the port, we built a 15-task A/B comparison suite (`evals/`) covering Move 2024 syntax migrations, OTW pattern, dynamic object fields, transfer policies, randomness, Walrus, Seal, and SDK 2.0. First scored run:

| | v1 (main) | v2 (full vercel-port) |
|---|---|---|
| Literal grader pass rate | 15/15 | 13/15 |
| Functional pass rate (after adjudicating grader artefacts) | 13/15 | 13/15 |

**Tie on functional outcome.** The literal grader gap was 4 grader artefacts in opposite directions — TODO-comment false positives on v1 (tasks 09, 14), idiomatic-form false negatives on v2 (tasks 12, 15). After adjudication: functional parity.

The scoring run flagged a **suspected verbose-TODO regression** on v2: tasks 09/14/15 showed v2 deferring implementation to TODO comments more often than v1, plausibly caused by the matcher over-injecting reading material and the agent satisficing on implementation as a result. Not a confident verdict — just a tracked concern.

**Verdict from this run**: zero quality lift from the full vercel-port machinery on this suite. The architectural complexity didn't pay rent.

---

## 4. What got cut and why — `v2-minimal` (commit `97484c5`)

The matcher exists to disambiguate skills against vague prompts when a plugin has many of them. `vercel-plugin` ships ~19 skills. sui-pilot ships **5, all directly invokable as slash commands** (`/move-code-quality`, `/move-code-review`, `/move-pr-review`, `/move-tests`, `/oz-math`). The matcher was solving a problem this plugin doesn't have.

A second smoking gun: `hooks/src/lexical-index.mts` shipped 1,978 lines of `SYNONYM_MAP` that was Vercel vocabulary verbatim (`ssr`, `isr`, `next-rewrite`, `edge-middleware`, `satori`, `preview-deployment`, `feature-flag`, `og/opengraph`) — never re-tuned for Sui. The transplant was structural, not semantic.

The cut (commit `97484c5`, -17,389 LOC across 57 files):

| Path | Reason |
|---|---|
| `hooks/` (full tree: `src/*.mts`, compiled `*.mjs`, tsup config, tests) | Matcher pipeline + Vercel-vocab lexical index + orphans `stemmer.mts` + `unified-ranker.mts`. |
| `sui.md` | Runtime consumer was only `hooks/src/sui-context.mts`. |
| `sui-session.md` | Runtime consumer was only `hooks/src/inject-sui-context.mts`. |
| `generated/skill-manifest.json` + `scripts/build-manifest.ts` | Consumed only by the two injection hooks. |
| `scripts/doctor.ts` + `scripts/verify.sh` + `commands/sui-pilot-doctor.md` | Health checks for components that no longer exist. |
| `CONTEXT_INJECTION.md` | 543-line pipeline walkthrough; stale post-cut. |
| `matcher` frontmatter in 5 `skills/*/SKILL.md` | Inert without the manifest. |

Post-cut baseline (2026-05-11, commit `12d600d`):

| | v1 (main) | v2 (cut, `97484c5`) | Δ |
|---|---|---|---|
| Literal grader | 14/15 | 14/15 | **0** |

Dead heat. The trimmed v2 produces bit-identical outputs to v1 on every task. The precut verbose-TODO regression resolved without the matcher.

**Empirical validation: ~17 K LOC of complexity removed with zero observable quality cost on this suite.**

---

## 5. The eval framework introduced — a foundation for Sui-related skill evals

The eval harness in `evals/` was built ad-hoc to validate the cut. But it generalizes to **any A/B comparison between Claude Code plugin shapes targeting Sui Move development**, and is intended as a starting point for evaluating other Sui-related skills, agents, and prompt strategies. The rest of this section is the operator-and-design narrative for that framework.

### 5.1 Why evals matter here

Training drift on Sui/Move is real and fast. The Sui framework, Move standard library, and TypeScript SDK ship breaking changes monthly. A plugin's value proposition is "ground the agent in current docs instead of stale training memory," but that's an empirical claim — easy to assume, hard to validate without measurement.

The eval suite turns "the plugin makes the agent better" from a hope into a falsifiable hypothesis. The 2026-04-30 result killed our confidence that the full vercel-port mattered; the post-cut result preserved confidence that the slim shape is parity-or-better. Same machinery, different verdicts.

### 5.2 Architecture

```
evals/
├── tasks.json          # The suite: N entries with id, prompt, fixturePath, passCriteria, optional rubric
├── fixtures/<task-id>/ # Starting state per task: Move package OR TS sources
├── compare-prompt.md   # Scorer prompt; rendered to HTML by claude -p
├── run-comparison.sh   # The runner: checkout + claude -p + diff + compile gate + tokens
└── results/<UTC-ts>/   # Gitignored per-run artefacts (diffs, raw JSON, score.html, tokens.csv)
```

**Two-way comparison.** Each version runs the entire suite. The default is `v1=main` vs `v2=feat/v2-graph-port`, but `--v1-ref` / `--v2-ref` let you compare any two refs.

**Why not a "no-plugin" control arm?** Considered, dropped. `claude --bare` requires `ANTHROPIC_API_KEY` (Console billing, separate from Claude Max) and the disable-the-plugin alternative requires a plugin-state restore dance that's too fragile for the marginal information it produces. The plugin's qualitative value over no-plugin is obvious; the interesting comparison is between *plugin shapes*.

### 5.3 Task categories

The 27-task suite spans 5 categories, each surfacing different architectural pressure:

| Category | Count | What it stresses |
|---|---|---|
| `tier-1` | 15 | Single-file criterion-targeted edits (Move 2024 syntax, OTW, DOF, transfer policy, randomness, Walrus, Seal, SDK 2.0). These are the "easy" suite — both architectures converged to 14/15 here. |
| `multi-file` | 4 | Renames across modules, monolith splits, multi-file SDK migrations, DOF + accessor + test. Strains the agent's ability to maintain coherent reasoning across files. |
| `ambiguous` | 3 | "Make this safer / add a fee / clean up naming" — many valid interpretations. Scored via LLM rubric (correctness/idiomaticity/safety/brevity, 1-5 each, threshold ≥16). |
| `stale-training` | 4 | Post-cutoff or rarely-trained Sui APIs: `derived_object`, GraphQL client, Coin Registry migration, `Display<T>`. The correct answer requires reading the bundled docs; training memory will produce the wrong API. |
| `token-pressure` | 1 | A 1.5 KB structured spec with 6 acceptance bullets and 4 edge-case aborts. Strains main's larger preamble budget more than v2's. |

Authoring guidance for new tasks: pick a category that surfaces the comparison you care about, not whatever's easiest to write. Single-file substring-matched tasks are usually the wrong tool — both architectures converge fast.

### 5.4 Pass-criteria types

Schema is additive — old tasks stay valid, new tasks opt into richer checks:

| Field | Purpose |
|---|---|
| `containsString` | The target file must contain the literal substring after the model's edit. Comment-only mentions are rejected. |
| `containsRegex` | Perl-compatible regex variant. Supersedes `containsString` when both present. Use when accepting multiple valid forms (e.g. `coin::create_currency(<\w+>)?\(otw,`). |
| `doesNotContainString` | The opposite — listed substring must be gone after the edit. |
| `alsoContainsString` / `alsoContainsRegex` | Second positive check, same semantics. |
| `additionalFiles` | Array of `{file, containsString, ...}` for multi-file tasks. Each entry is checked independently. |
| `compileAfter: true` | Runs `sui move build` on the post-state tmpdir. Pass requires exit 0. Skipped (not failed) if `sui` isn't on PATH. |
| `rubric` | Replaces literal checks with an LLM-graded scorecard: 4 criteria scored 1-5, gated on `sum >= passThreshold` (default 16). Reserved for `category: "ambiguous"`. |

The grader rejects substring matches that lie inside Move comments (`//` or `/* */`). This was added after the precut run's TODO-comment false positives.

### 5.5 Scoring

Each version's run produces, per task: `<id>.diff` (the canonical evidence of what the model did), `<id>.out` (model text from JSON), `<id>.tokens` (usage block), and optionally `<id>.compile-exit` + `<id>.build.{out,err}` when the compile gate ran. After all versions finish, `claude -p` reads `compare-prompt.md` + every per-task artefact and emits a self-contained `score.html` (semantic HTML5, inline CSS only) with:

- Headline pass rates per version
- Per-task pass/fail with one-line reasons
- "Differentiators" — tasks where versions disagree (the architecturally interesting cases)
- Per-category breakdown
- Token economics (aggregated from `tokens.csv`)
- Plain-English verdict

The HTML output is intentionally self-contained so it can be archived, emailed, or copy-pasted without external CSS/JS.

### 5.6 How to extend for other Sui-related skills

The pattern generalizes. Replace the comparison axis:

- **Comparing two prompts for the same skill** → `--v1-ref` and `--v2-ref` to two branches that only differ in `skills/your-skill/SKILL.md`.
- **Comparing two models** — wire `--model` into the runner's `claude_cmd` array and run the same suite under both.
- **Comparing a new MCP integration** → branch the plugin with the new MCP wired in, run.

Tasks should target *your skill's claimed value*. A code-review skill should be evaluated against real-world Move code with planted issues, scored via the LLM rubric on whether the review caught them. A test-generation skill should be evaluated by running `sui move test` on the generated tests.

The eval harness itself doesn't care what your skill does — it cares that there's a measurable post-state.

### 5.7 Costs and operator notes

A 27-task × 2-version run is ~54 `claude -p` invocations, ~1.5h wall clock, draws on the user's Claude Max daily allotment. The runner caches `tasks.json` and `fixtures/` *before* any branch switch so the suite stays consistent even when the working tree is mutated mid-run. The trap on `EXIT` restores the original branch even on `Ctrl-C` or crash.

`--resume <results-dir>` skips tasks whose `.diff` already exists — useful for backfilling a single version into an existing run.

---

## 6. Results of the denser run (2026-05-11T12-12-13Z)

Full data, with caveats, in `evals/BASELINE.md` → "Tier-2 denser suite" section. Short version:

| | v1 (main `d65a4965`) | v2 (cut `13a4d60b`) | Δ |
|---|---|---|---|
| Pass rate (literal) | 15/27 | 15/27 | 0 |
| Pass rate (compile gate ignored) | 25/27 | 25/27 | 0 |
| Output tokens | 160,878 | 188,827 | +17% |
| cache_read tokens | 18.9M | 23.8M | +26% |
| Estimated public-rate cost | 1.00× | 1.10× | v2 ~10% more expensive |

**Dead heat on every individual task.** On the only ambiguous task where a rubric could have visibly diverged the two arms (`task-22-naming-cleanup`), they emit **byte-identical** code.

### What survives the caveats

The run shipped with three infrastructure bugs that inflated literal failures from 2 to 12 in both arms (`sui move build --build-env` not passed, two grader bugs, scorer wrapped its HTML in fences — all fixed in commit `003c42c`). The failures cancel between arms — the v1-vs-v2 verdict stands. What it tells us:

- **Quality**: v1 ≈ v2 across every category. The slim plugin shape doesn't degrade output quality vs the pipe-delimited preamble. It also doesn't improve it on these 27 tasks.
- **Cost**: v2 is **~10% more expensive** on the public Anthropic rate card. The savings on `cache_create` from the smaller preamble (-8%) are outweighed by the doc-first per-task `cache_read` overhead (+26%) and slightly longer outputs (+17%). The "v2 saves tokens" claim deserves nuance: true for *always-loaded preamble bytes* (2.9 KB vs 19.4 KB), but doc-first per-task reads more than compensate on fresh `claude -p` invocations.
- **Maintenance**: the cut still removes ~17 K LOC. That's the unambiguous win — a smaller surface area to maintain, debug, and explain, for no quality cost.

### What didn't get tested

The compile-gate environment bug killed step-4-of-5 of the scoring procedure on tasks 16-23 + 25-27, which gates the rubric (step 5). The 3 ambiguous tasks (20-22) never reached the rubric, so the "does v2 pick more idiomatic Move 2024?" question is **unanswered for this run**. The qualitative diff read says "both arms produce comparably idiomatic Move 2024" but that's eyeballing, not a rubric verdict.

### Decision-grade signal?

For "is the cut safe?" → **yes, conclusively**. Dead heat across difficulty tiers, byte-identical on the most ambiguous fixture.

For "does v2 deliver productivity gain over v1?" → **no measurable gain on this fixture set**. The slim shape is parity-or-cheaper on always-loaded context and parity-or-slightly-more-expensive on per-task token cost. The case for shipping v2 is maintenance complexity (-17 K LOC), not session economics.

For "should we re-run with the env fix?" → not urgent. The next run would surface 3 rubric verdicts and resolve 10 currently-`✗ env` tasks, but it would not change the v1-vs-v2 comparison (diffs are identical). Worth re-running when the task set expands or the model/docs change substantially.

---

## 7. Open questions and future work

- **Grader sophistication.** The current grader is substring + regex + comment exclusion + compile + LLM rubric. The next step is per-task `sui move test` runs to validate generated tests *behave* correctly, not just compile. For TS tasks, `tsc --noEmit` against the post-state would catch type errors.

- **Denser suite still needed?** If the 27-task Tier-2 run shows v2-minimal still parity with main, the conclusion is that the slim plugin shape is *good enough* and we're chasing diminishing returns on architectural changes — the marginal gain is in skill content + bundled doc freshness, not preamble shape. If v2 wins on multi-file or stale-training, the slim-preamble + doc-first hypothesis is empirically validated and worth doubling down on.

- **Cross-plugin eval pattern.** This harness is sui-pilot-centric (Move/TS task fixtures, sui-pilot's docs assumed). Extracting it into a reusable Claude Code eval pattern (akin to `corpus-qa-skill-pattern`) is worthwhile follow-up. Other Mysten-Labs-aligned plugins (a hypothetical `walrus-pilot`, `seal-pilot`) would benefit from the same scaffolding.

- **CI integration.** The eval suite currently runs on-demand. Wiring `score.html`'s aggregate pass-rate into CI as a regression gate (block merges where v2 pass-rate < current main on a frozen subset) would prevent silent skill degradation across future refactors. Cost-aware design needed — running 54 `claude -p` per PR is non-trivial.

- **The "token economics" question.** Even at quality parity, v2-minimal saves preamble tokens. The Tier-2 baseline will quantify per-task input-token deltas. If the delta is small (say <5%), the cut was primarily a maintenance-burden win, not a token win. If it's large (>20%), the slim preamble pays for itself on long sessions.

---

## 8. Lessons

Three things this branch surfaced that are worth carrying forward:

1. **Transplanted architecture is a hypothesis, not a conclusion.** The matcher was a good idea for the plugin where it was first written; it didn't pay rent here because sui-pilot's skills aren't ambiguous. Resist the urge to assume a sibling-plugin's approach generalizes — test it.

2. **Eval before refactor.** The 15-task suite caught what review wouldn't have. The cut was justified by data, not vibes. Future significant refactors should land an eval baseline first.

3. **Substring grading is noisy.** Half the work on this branch was repeatedly tightening the grader as the suite revealed new false-positive and false-negative classes (TODO comments, idiomatic form variants, comment-vs-implementation). Plan for the grader to be a living artifact, not a write-once script.
