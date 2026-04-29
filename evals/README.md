# Eval suite (stub)

Move tasks where Sui training data is stale enough that a baseline model fails. Used to
score baseline / v1 (pipe-index) / v2 (slim preamble + sui.md + hooks) on pass-rate and
token-cost-per-task.

## Task seed list

10–15 tasks covering:

1. Convert `module x::y { ... }` to `module x::y;` (Move 2024 file-level form).
2. Replace `vector::push_back(&mut v, x)` calls with method-call syntax.
3. Use `vector::do!` macro for a hand-written loop.
4. Implement a one-time witness module (consumes OTW in `init`, creates a `Coin` currency).
5. Add a dynamic object field (`dof`) accessor to a parent object.
6. Migrate a Sui 1.x explicit-framework `Move.toml` to implicit (Sui 1.45+).
7. Add a hot-potato pattern for a multi-step trade flow.
8. Build a transfer policy with a royalty rule.
9. Write a `test_scenario` that exercises a shared object's contention path.
10. Migrate `@mysten/sui/client.SuiClient` to `@mysten/sui/jsonRpc.SuiJsonRpcClient` with required `network` parameter.
11. Implement a derived object child with deterministic UID derivation.
12. Add a randomness-driven raffle using `sui::random::Random`.
13. Write a Walrus blob-publish flow that anchors the commitment as a Sui object.
14. Add a Seal-encrypted secret with a capability-gated decryption policy.
15. Write a Move 2024 enum + `match` exhaustive handler for a state machine.

## Schema (target file: `evals/move-tasks.json`)

```json
[
  {
    "id": "task-01-module-syntax",
    "title": "Convert legacy module syntax to Move 2024 file-level form",
    "fixturePath": "fixtures/legacy-module",
    "prompt": "Update the module declaration to Move 2024 file-level syntax.",
    "expectedSkills": ["move-code-quality"],
    "expectedChunk": "Move type system & abilities",
    "passCriteria": {
      "containsString": "module example::demo;",
      "doesNotContainString": "module example::demo {"
    }
  }
]
```

## Runner (target: `evals/run.ts`)

For each task:
1. Set up the fixture as `CLAUDE_PROJECT_ROOT`.
2. Run baseline (no plugin), v1 (current main), v2 (this branch).
3. Score: pass/fail per `passCriteria`, token cost via prompt+completion estimation.
4. Emit a JSON report; fail CI if v2 pass-rate < v1 pass-rate.

## Status

Stub only — task fixtures and runner are follow-up work. The plan-of-record gates v2
release on this suite passing, but it can be authored after the hooks land.
