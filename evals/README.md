# sui-pilot eval suite

Empirical A/B comparison: does sui-pilot v2 outperform v1 on real Sui/Move tasks where training data is stale?

## TL;DR — one command

```bash
bash evals/run-comparison.sh
```

That's the whole flow. The runner switches `~/.claude/sui-pilot` between `main` (v1) and `feat/v2-graph-port` (v2), runs every task in `tasks.json` against each version using `claude -p`, captures diffs of what the model changed in each fixture, then auto-invokes `claude -p` one more time to score the delta and write a Markdown report to `results/<timestamp>/score.md`.

Restores your original branch when finished, even on error.

## What it does, step by step

```
┌─────────────────────────────────────────────────────────────┐
│ run-comparison.sh                                           │
│                                                             │
│  1. Save current branch of ~/.claude/sui-pilot              │
│                                                             │
│  2. For each version v in [v1=main, v2=feat/v2-graph-port]: │
│      a. cd ~/.claude/sui-pilot && git checkout <v's ref>    │
│      b. For each task in tasks.json:                        │
│          - mktemp -d → tmpdir                               │
│          - cp -a fixtures/<task.fixturePath>/. tmpdir/      │
│          - cd tmpdir && claude -p "<task.prompt>"           │
│              > results/<TS>/<v>/<id>.out                    │
│              2> results/<TS>/<v>/<id>.err                   │
│          - diff -ruN fixture tmpdir > <id>.diff             │
│                                                             │
│  3. Restore original branch                                 │
│                                                             │
│  4. Auto-score: claude -p < compare-prompt.md               │
│                  > results/<TS>/score.md                    │
└─────────────────────────────────────────────────────────────┘
```

User intervention: **0 commands** between launching the script and reading the scored report.

## Prerequisites

Already present if you're using sui-pilot:

- `claude` CLI on PATH (the runner uses `claude -p` non-interactive mode)
- `jq` (for parsing `tasks.json`)
- `git`, `diff`, `mktemp` (standard)
- Network access (the model contacts Anthropic; fixtures don't make network calls)

The runner refuses to start if any tool is missing.

## Files

| File | Purpose |
|---|---|
| `run-comparison.sh` | The runner. One command, no flags needed for the default v1-vs-v2 comparison. |
| `tasks.json` | The task definitions: `id`, `title`, `fixturePath`, `prompt`, `passCriteria`. |
| `compare-prompt.md` | The scoring template. The runner pipes this to `claude -p` after both versions have run. |
| `fixtures/<task>/` | The starting state for each task. Each fixture is a self-contained tiny project (Move package or TS source). |
| `results/<UTC-timestamp>/` | Per-run output. Created by the runner. Gitignored — see below. |

## Tasks (15 tier-1 + 12 Tier-2 = 27 total)

The original 15-task seed suite (tier-1) covers Move 2024 syntax/idiom migrations, Sui-runtime patterns where post-cutoff training is shaky, and the off-chain stack (Walrus, Seal, TS SDK 2.0). Each tier-1 task starts from a fixture that's a working stub and asks for a specific, narrow change. The Tier-2 expansion (tasks 16-27) adds multi-file refactors, ambiguous-spec rubric-graded tasks, stale-training traps, and one token-pressure task — see `NOTES.md` §5 for the design rationale and per-category breakdown.

| ID | Stale-training axis | Fixture |
|---|---|---|
| `task-01-module-syntax` | Move 2024 file-level module form (`module x::y;` vs `{ }`) | `fixtures/legacy-module/` |
| `task-02-sdk-2-client` | `@mysten/sui` v2 SDK migration (`SuiClient` → `SuiJsonRpcClient`) | `fixtures/sdk-1-client/` |
| `task-03-otw` | One-time-witness for `coin::create_currency` | `fixtures/otw-coin/` |
| `task-04-vector-method-syntax` | `v.push_back(x)` Move 2024 method-call form | `fixtures/vector-method-syntax/` |
| `task-05-do-macro` | `vector::do!` replacing a hand-written `while` | `fixtures/do-macro/` |
| `task-06-dynamic-object-field` | `dof::add` + `dof::borrow` accessor on a parent | `fixtures/dynamic-object-field/` |
| `task-07-implicit-framework` | `Move.toml` Sui 1.45+ implicit-deps migration | `fixtures/implicit-framework/` |
| `task-08-hot-potato` | `Receipt` (no abilities) + consume function | `fixtures/hot-potato/` |
| `task-09-transfer-policy-royalty` | `transfer_policy::new` + royalty rule | `fixtures/transfer-policy-royalty/` |
| `task-10-test-scenario` | `test_scenario::take_shared` contention path | `fixtures/test-scenario/` |
| `task-11-derived-object` | `sui::derived_object` deterministic-UID child | `fixtures/derived-object/` |
| `task-12-randomness-raffle` | `sui::random::Random` raffle draw | `fixtures/randomness-raffle/` |
| `task-13-walrus-blob-anchor` | `@mysten/walrus` write + Sui object commitment | `fixtures/walrus-blob-anchor/` |
| `task-14-seal-policy-encrypt` | `@mysten/seal` capability-gated encryption | `fixtures/seal-policy-encrypt/` |
| `task-15-enum-match` | Move 2024 `enum` + exhaustive `match` | `fixtures/enum-match/` |

**Pass criteria are tightened past substring-match in comments.** Where a task could be falsely passed by a TODO comment that mentions the function name (the failure mode the first eval run exposed), the criterion includes parentheses or type parameters (e.g. `coin::create_currency<DEMO>(`) so the model has to actually write the call, not just reference it. The scorer also rejects substring matches that lie inside Move comments (`//` and `/* */`).

## Two-way comparison (`v1`, `v2`)

The runner compares two arms, controlled by `--versions`:

| Arm | What runs | How |
|---|---|---|
| `v1` | sui-pilot at `--v1-ref` (default `main`) | `git checkout` + plain `claude -p`. |
| `v2` | sui-pilot at `--v2-ref` (default `feat/v2-graph-port`) | `git checkout` + plain `claude -p`. |

A "no-plugin" control arm was considered and dropped — `claude --bare` requires `ANTHROPIC_API_KEY` (billed separately from Claude Max plans) and the disable-the-plugin alternative isn't worth the hassle relative to what it tells you. The plugin's value over no-plugin is qualitatively obvious; the interesting comparison is v1 (full pipe-delimited preamble + matcher) vs v2 (slim preamble, no matcher).

## Adding more tasks

1. Create `evals/fixtures/<your-task>/` with a starting state (whatever directory layout the model would see in a real project — `Move.toml` + `sources/`, or `package.json` + `src/`).
2. Add an entry to `tasks.json`. The schema:

   ```jsonc
   {
     "id": "task-NN-your-id",
     "title": "Short human description",
     "fixturePath": "fixtures/your-task",
     "prompt": "What you'd type to Claude Code in a fresh session in this fixture",
     "category": "tier-1",  // optional: tier-1 | multi-file | ambiguous | stale-training | token-pressure
     "passCriteria": {
       "file": "<relative path inside fixture>",
       "containsString": "<expected substring after fix>",       // optional
       "containsRegex": "<perl-compatible regex>",               // optional, supersedes containsString
       "doesNotContainString": "<substring that should be gone>",// optional
       "doesNotContainRegex": "<perl regex variant>",            // optional, supersedes doesNotContainString
       "alsoContainsString": "<second positive check>",          // optional
       "alsoContainsRegex": "<second positive check, regex form>", // optional, supersedes alsoContainsString
       "additionalFiles": [                                      // optional, for multi-file tasks
         { "file": "<path>", "containsString": "..." }
       ],
       "compileAfter": true                                      // optional, runs `sui move build`
     },
     "rubric": {                                                 // optional, for category=ambiguous
       "criteria": [
         "correctness — does the change implement the requested behaviour?",
         "idiomaticity — Move 2024 conventions, method-call form, capability shape",
         "safety — access control, arithmetic, shared-object hazards",
         "brevity — minimal scope creep"
       ],
       "scale": "1-5",
       "passThreshold": 16
     }
   }
   ```

   All new fields are optional; existing tier-1 substring-only tasks stay valid.

3. Re-run `bash evals/run-comparison.sh`. No code changes, no fixture wiring.

## Customizing the comparison

```bash
# Default: both arms + auto-score
bash evals/run-comparison.sh

# Single-version dry-run
bash evals/run-comparison.sh --versions v2 --no-score

# Compare a specific tag against your working branch
bash evals/run-comparison.sh --v1-ref v0.1.0 --v2-ref feat/my-improvement

# Run the suite without auto-scoring (e.g., to inspect raw diffs first)
bash evals/run-comparison.sh --no-score

# Resume a partial run (skips tasks whose .diff already exists)
bash evals/run-comparison.sh --resume evals/results/<TS>

# Use a non-default sui-pilot install location
SUI_PILOT_DIR=/path/to/other/sui-pilot bash evals/run-comparison.sh
```

## Output layout

```
evals/results/2026-04-29T18-42-15Z/
├── v1.sha                              # SHA of the v1 run
├── v2.sha                              # SHA of the v2 run
├── tokens.csv                          # per-task per-version token usage
├── v1/
│   ├── task-01-module-syntax.out       # model text (extracted from JSON)
│   ├── task-01-module-syntax.err       # model stderr
│   ├── task-01-module-syntax.diff      # diff -ruN of fixture vs post-run state
│   ├── task-01-module-syntax.tokens    # usage JSON block
│   ├── task-01-module-syntax.raw.json  # full claude -p JSON envelope
│   ├── task-01-module-syntax.compile-exit  # only when compileAfter:true
│   ├── task-01-module-syntax.build.{out,err}  # only when compile gate ran
│   └── ...
├── v2/ ... (same shape)
└── score.html                          # the auto-scored self-contained HTML report
```

You only need to read `score.html`. The other files are kept for spot-checking when a result looks surprising.

## Why this design

- **`claude -p` non-interactive** — every invocation is a fresh session, so SessionStart fires, hooks register, MCP servers spawn, dedup state starts clean. No "did the previous session contaminate this one?" risk.
- **`diff` of fixture vs post-state** — what the model *did* matters more than what it *said*. The diff is the canonical evidence; `.out` is supporting context for the scorer.
- **Auto-scoring via `claude -p`** — a separate Claude turn reads `tasks.json`, applies `passCriteria` literally, and produces the HTML delta report. Removes the user from the scoring loop entirely.
- **One report file** — `results/<TS>/score.html` is the only thing you read after a run. Everything else is debug evidence.
- **Branch restore on exit** — the trap restores your original branch on `EXIT`, even if the runner crashes mid-task. You don't end up stranded on a feature branch.

## Status

The current suite ships:
- Runner (`run-comparison.sh`) — 2-way `v1`/`v2`; captures tokens; runs an optional compile-gate.
- 27 tasks across 5 categories (15 tier-1, 4 multi-file, 3 ambiguous, 4 stale-training, 1 token-pressure).
- Scoring prompt (`compare-prompt.md`) — emits self-contained HTML, supports rubric grading for ambiguous tasks.
- Two preserved baselines in `BASELINE.md`: 2026-04-30 (precut full v2) and 2026-05-11 (post-cut v2-minimal).

Follow-up work, when ready to spend the API budget:
- Run the full 27-task suite (~1.5h wall clock, both versions) and append a Tier-2 baseline section to `BASELINE.md`.
- Wire `score.html`'s aggregate pass-rate into CI as a regression gate (block merges where v2 pass-rate < current main).
