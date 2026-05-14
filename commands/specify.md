---
name: specify
description: Author formal specifications (`#[spec(prove)]`) for every externally reachable function in the current Move package, with sui-prover verification and per-function user review
---

Invoke the `specify` skill to walk through formal-specification authoring for the Move package in the current directory.

## What This Command Does

- Probes the local `sui-prover` binary and the package's `Move.toml` for setup issues (capabilities, edition, implicit-dep readiness).
- Discovers every externally reachable function (`public` non-package + `entry`) under `sources/`.
- Builds a per-function context (signature, callees, observable effects, abort paths).
- Asks the user — one structured AskUserQuestion batch per function — for invariants, preconditions, postconditions, and abort conditions.
- Drafts a `#[spec(prove)]` twin function and writes it inline at the bottom of the same `.move` file (between `// === sui-pilot specify: generated specs ===` markers).
- Runs `sui-prover` via the `sui-prover-mcp` MCP and iterates on failures using the failure taxonomy at `skills/specify/references/failure-taxonomy.md`.
- Persists progress to `.specify-progress.json` at the package root so the flow is resumable.
- Emits a self-contained HTML audit at `.specify-report.html` on completion.

## When to Use

- After implementing new `public` / `entry` functions and before deploying to mainnet.
- When introducing formal verification to an existing Move package for the first time.
- Pre-audit pass to surface abort conditions and missing invariants.

## When NOT to Use

- For verifying `public(package)` or private functions — the prover treats them interchangeably with `public`, but the `specify` flow scopes to externally-reachable functions per the plan.
- When `sui-prover` is not installed — install via `brew install asymptotic-code/sui-prover/sui-prover` first.
- When `Move.toml` still pins `Sui` or `MoveStdlib` explicitly — the prover requires Sui 1.45+ implicit-dep injection; the skill will surface a `setup_warning` and stop.

## Limitations

- Single-package scope. Cross-package spec generation (the `target = other_pkg::mod::fn` form) is deferred.
- Spec quality is bounded by the user's answers to the `AskUserQuestion` batches; vague answers produce weak specs.
- Some Move code patterns require `no_opaque` or `boogie_opt` tuning that the skill suggests but cannot always derive automatically — the failure-taxonomy file documents the manual escape hatches.

## Related Commands

- `/move-code-review` — Identifies which functions most need specs (SEC-* findings).
- `/move-code-quality` — Style/idiom pass that should precede formal verification.
- `/move-tests` — Behavioural tests; complementary to formal specs, not a replacement.
