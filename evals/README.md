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

## Tasks shipped in this PR (15 tasks)

The full set from the original `DESIGN_V2.md` brief — covering Move 2024 syntax/idiom migrations, Sui-runtime patterns where post-cutoff training is shaky, and the off-chain stack (Walrus, Seal, TS SDK 2.0). Each task starts from a fixture that's a working stub and asks for a specific, narrow change.

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

**Pass criteria are tightened past substring-match in comments.** Where a task could be falsely passed by a TODO comment that mentions the function name (the failure mode the first eval run exposed), the criterion includes parentheses or type parameters (e.g. `coin::create_currency<DEMO>(`) so the model has to actually write the call, not just reference it.

## Adding more tasks

1. Create `evals/fixtures/<your-task>/` with a starting state (whatever directory layout the model would see in a real project — `Move.toml` + `sources/`, or `package.json` + `src/`).
2. Add an entry to `tasks.json`:

   ```json
   {
     "id": "task-04-your-id",
     "title": "Short human description",
     "fixturePath": "fixtures/your-task",
     "prompt": "What you'd type to Claude Code in a fresh session in this fixture",
     "passCriteria": {
       "file": "<relative path inside fixture>",
       "containsString": "<expected substring after fix>",
       "doesNotContainString": "<substring that should be gone>"
     }
   }
   ```

   Optional: `alsoContainsString` for a second positive check.

3. Re-run `bash evals/run-comparison.sh`. No code changes, no fixture wiring.

## Customizing the comparison

```bash
# Compare a specific tag against your working branch
bash evals/run-comparison.sh --v1-ref v0.1.0 --v2-ref feat/my-improvement

# Run the suite without auto-scoring (e.g., to inspect raw diffs first)
bash evals/run-comparison.sh --no-score

# Use a non-default sui-pilot install location
SUI_PILOT_DIR=/path/to/other/sui-pilot bash evals/run-comparison.sh
```

## Output layout

```
evals/results/2026-04-29T18-42-15Z/
├── v1.sha                         # full SHA of the v1 run
├── v2.sha                         # full SHA of the v2 run
├── v1/
│   ├── task-01-module-syntax.out  # claude -p stdout
│   ├── task-01-module-syntax.err  # claude -p stderr
│   ├── task-01-module-syntax.diff # diff -ruN of fixture vs post-run state
│   └── ...
├── v2/
│   └── ... (same shape as v1/)
└── score.md                       # the auto-scored Markdown report
```

You only need to read `score.md`. The other files are kept for spot-checking when a result looks surprising.

## Why this design

- **`claude -p` non-interactive** — every invocation is a fresh session, so SessionStart fires, hooks register, MCP servers spawn, dedup state starts clean. No "did the previous session contaminate this one?" risk.
- **`diff` of fixture vs post-state** — what the model *did* matters more than what it *said*. The diff is the canonical evidence; `.out` is supporting context for the scorer.
- **Auto-scoring via `claude -p`** — a separate Claude turn reads `tasks.json`, applies `passCriteria` literally, and produces the Markdown delta report. Removes the user from the scoring loop entirely.
- **One report file** — `results/<TS>/score.md` is the only thing you read after a run. Everything else is debug evidence.
- **Branch restore on exit** — the trap restores your original branch on `EXIT`, even if the runner crashes mid-task. You don't end up stranded on a feature branch.

## Status

This PR ships:
- Runner (`run-comparison.sh`)
- 3 seed tasks + fixtures
- Scoring prompt (`compare-prompt.md`)
- This README

Follow-up work, when v2 is in main and you want a denser baseline:
- Expand to 10–15 tasks (Move 2024 macros, transfer policies, dynamic-object fields, randomness, party objects, Walrus blob anchoring, Seal access policies, gRPC client, dapp-kit-react migration, etc.)
- Wire `score.md`'s aggregate pass-rate into CI as a regression gate (block merges where v2 pass-rate < current main).
- Add token-cost capture alongside pass-rate (`claude -p --json` gives usage; aggregate per-task and per-run averages).
