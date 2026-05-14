---
name: specify
description: "Walks the user through writing `#[spec(prove)]` formal specifications for every externally reachable function (`public` non-package + `entry`) in their Sui Move package, drives sui-prover via the sui-prover-mcp, and iterates on failures using a documented taxonomy. Use this skill when the user invokes `/specify`, asks to 'add formal verification', 'write prover specs', 'verify this package with sui-prover', or wants to harden a Move package before mainnet deploy. Skip for `public(package)` or private functions (out of scope), or when sui-prover isn't installed. Complements /move-code-review (SEC-* findings indicate where specs matter most) and /move-tests (specs are static guarantees, tests are dynamic samples)."
---

# Specify — formal specifications for Sui Move

> **Doc-First Requirement.** Read `.sui-prover-docs/` before drafting any spec. The Sui Prover spec language is **not** the legacy Move Prover MSL — it uses `#[spec(prove)]`, `requires`, `ensures`, `asserts` (positive abort form), and the macros `clone!`, `forall!`, `exists!`, `invariant!`. It does NOT use `aborts_if`, `pragma`, `apply`, `assume`, or free `axiom`. Verify any construct against `.sui-prover-docs/guide/spec-reference.md` before emitting it.

## Architecture

This skill is a multi-phase, per-function orchestrator. It uses:

- `mcp__sui-prover__prover_capabilities` — startup probe (binary, toolchain, setup warnings)
- `mcp__sui-prover__list_specs` — idempotency and resume
- `mcp__sui-prover__prove_package` — verification, including `target_function` filter
- `mcp__move-lsp__move_diagnostics` — compile-health gate
- `mcp__move-lsp__move_find_references` — call-cascade traversal
- `mcp__move-lsp__move_goto_definition` — callee inspection
- `Glob` / `Grep` / `Read` — visibility classification (the LSP does **not** return visibility on document symbols; see `references/spec-patterns.md` §1 for the regex contract this skill uses)
- `AskUserQuestion` — every gate where intent is human-supplied

## Phase 0 — Validate (single shot)

1. Call `mcp__sui-prover__prover_capabilities` with `move_toml_path` set to the user's package root.
2. Call `mcp__move-lsp__move_diagnostics` with `scope: 'file'` on any one `.move` file under `sources/` to confirm the package compiles before we start writing into it.
3. If `binary.found === false` → STOP, ask the user to `brew install asymptotic-code/sui-prover/sui-prover`.
4. If `setup_warnings` is non-empty (explicit `Sui`/`MoveStdlib` deps, non-2024 edition):
   - Surface every warning verbatim.
   - **AskUserQuestion (single batch)**: "fix Move.toml myself first / proceed anyway (specs may not compile) / abort". Default suggestion: "fix first".
   - **Never auto-edit the user's Move.toml.** Surface the line to change and let them do it.

## Phase 1 — Discover externally reachable functions

Per the plan, the target set is `public` (non-package) + `entry`. Use the regex contract in `references/spec-patterns.md` §1 — **not** `move_document_symbols`, which collapses all visibilities to `kind: 'function'`.

1. `Glob` `sources/**/*.move` under the package root.
2. For each `.move` file:
   - `Read` the file.
   - Strip line and block comments.
   - Apply the visibility regex (`references/spec-patterns.md` §1). Classify each `fun` declaration as `public`, `public(package)`, `entry`, `macro`, `native`, or private.
   - **Exclude** the immediately-preceding `#[test_only]`, `#[test]`, or `#[allow(...)]` attribute lines from the classifier window (lookback ≤ 1 attribute block, not 200 chars).
3. Build the target list: every `public` (excluding `public(package)`) + every `entry` (including those that are also `public`).
4. Call `mcp__sui-prover__list_specs` with the package root.
5. Mark each target as `verified` (already has a `#[spec(prove)]`), `pending` (no spec yet), or `partial` (has a `#[spec(skip)]` or `#[spec(focus)]` — needs upgrade).
6. Write `.specify-progress.json` at the package root with the initial state. **Add it to `.gitignore` proactively if it's not already excluded** — the file is per-run state, not source.

Report a one-line summary: "N externally-reachable functions: M verified, K pending, P partial".

## Phase 2 — Build cascade context (lazy, per-function)

For each function the user is about to spec:

1. `mcp__move-lsp__move_find_references` on the function's declaration position → list of callers.
2. For each callee invoked inside the function body (parsed from `Read` of the source):
   - `mcp__move-lsp__move_goto_definition` to find the callee's location.
   - `Read` the callee's source up to 30 lines.
   - Note whether the callee already has a spec via the Phase 1 map.
3. Limit depth to 2 by default. Cycle-detect with a visited set keyed on `<file>:<line>`. If the call graph exceeds 25 nodes for a single function, prompt the user (Phase 4 gate) to confirm before continuing.

The output of this phase is a per-function fact sheet the user sees during Phase 4: signature, abort conditions (extracted from `assert!(...)` lines in the body), state mutations (look for `*<binding> = ...` and `vector::push_back` / `table::add` calls), and callees with their spec status.

## Phase 3 — Prioritize

Order pending functions:

1. `entry` functions first (PTB-callable, highest blast radius).
2. Then `public` functions that take `&mut` references or write to `Table` / `Bag` / dynamic fields (highest mutation risk).
3. Then `public` functions that only read state (lower risk, often simpler specs).

**AskUserQuestion (single batch)**:
- "Specify all `N` pending functions in the default order"
- "Pick one to start with" (offer the top 5 by priority)
- "Pick a subset" (offer to filter by module or by mutation risk)

## Phase 4 — Per-function loop

For each pending function (sequentially — parallelism would race AskUserQuestion):

### 4.1 Surface (LLM)

Present a compact fact sheet to the user *inside the AskUserQuestion description*, not as a separate chat turn:

- Module + function name + signature
- Caller list (top 5)
- Callees with spec status
- Detected `assert!(cond, EError)` lines (these become candidate `asserts(cond)` entries)
- Detected state mutations
- Suggested invariants (LLM-derived from the body — explicitly mark as "suggestion, not proof")
- Excerpts from `.sui-prover-docs/examples/` for any pattern that matches (overflow, ghost state, bag/table)

### 4.2 Elicit (AskUserQuestion)

**One batched call** with up to 4 sub-questions, each with 3-4 options + Other. Concrete defaults so the user can accept fast:

1. **Preconditions (`requires`)**: "none / parameter range check (suggested: `x.to_int().add(y.to_int()).lte(MAX_U64)`) / state precondition / Other"
2. **Postconditions (`ensures`)**: "none / functional result (suggested: `result == x + y`) / state-after-call relation / Other"
3. **Abort conditions (`asserts`)**: present the detected `assert!` mirrors — "use all detected mirrors / use a subset / replace with custom / none"
4. **Invariants**: "none needed / loop invariant / type invariant / ghost-state invariant / Other"

### 4.3 Draft (LLM)

Render a `#[spec(prove)]` twin function in the canonical shape (see `references/spec-patterns.md` §2):

```move
#[spec(prove)]
fun <name>_spec(<params>): <return_type> {
    requires(<preconditions>);
    let __old = clone!(<mutable_state>);     // only if state mutation detected
    asserts(<abort_condition>);              // one per detected mirror
    let <r> = <name>(<args>);
    ensures(<postcondition>);
    <r>
}
```

Imports go in a `#[spec_only]` block at the bottom of the file, deduplicated against what's already there.

### 4.4 Review (AskUserQuestion)

Show the drafted spec inline. Single question:
- "Looks good — write it"
- "Refine" (provide feedback in Other field; loop to 4.3)
- "Skip this function" (mark `skipped` in progress file; move on)

### 4.5 Persist (deterministic)

Write the spec at the bottom of the same `.move` file, between markers:

```move
// === sui-pilot specify: generated specs (do not edit between markers) ===

#[spec_only]
use prover::prover::{requires, ensures, asserts, clone};
// (additional imports as needed)

#[spec(prove)]
fun <name>_spec(...) { ... }

// === end sui-pilot specify ===
```

**Idempotency rule.** If the marker block already exists, splice the new spec into it. Never duplicate a `#[spec(...)]` for the same function — if one exists, ask the user (4.4-style) whether to refine or overwrite.

**Cross-module fallback.** If the colocated spec causes a compile error (the prover SKILL.md edge case — see `references/spec-patterns.md` §3), offer to create a sidecar `<pkg>_specs/` package and emit the spec there with `target = pkg::mod::fn`. **AskUserQuestion before creating files outside the user's package directory.**

### 4.6 Verify (MCP)

`mcp__sui-prover__prove_package` with `target_function: "<pkg>::<mod>::<name>_spec"` and `timeout_seconds: 60` (configurable).

### 4.7 Diagnose failures

If `findings` contains a failure for this spec, consult `references/failure-taxonomy.md` — each `findings[].kind` maps to a documented remediation:

- `ensures_failed` → narrow postcondition or strengthen preconditions
- `asserts_failed` → missing/incorrect mirror of an `assert!`
- `abort_unspecified` → add an `asserts()` for an implicit abort path
- `timeout` → try `--split-paths`, then per-spec `boogie_opt` tuning
- `no_spec` on a callee → spec that callee first, or add `no_opaque` to bypass

### 4.8 Iterate (AskUserQuestion)

After surfacing the diagnostic + remediation suggestion:
- "Apply suggested fix" (loop to 4.3 with the suggestion seeded)
- "Try a different angle" (loop to 4.2 with the prior answers preserved)
- "Mark as needs-human" (record in progress file; continue to next function)
- "Skip this function"

Default `attempts ≤ 3` per function. Configurable via Phase 3 batch.

### 4.9 Persist progress

Update `.specify-progress.json` after each iteration. Schema:
```json
{
  "function_id": {
    "status": "pending" | "drafted" | "verified" | "skipped" | "needs_human" | "failed",
    "attempts": N,
    "last_error": "..."
  }
}
```

## Phase 5 — Hand off

When the user pauses, or when all pending functions are processed:

1. Write `.specify-report.html` at the package root — self-contained, semantic HTML5, inline CSS. Sections: package summary, per-function status, generated specs (with syntax-highlighted code blocks), open issues, next steps.
2. Print a one-screen summary to the chat: "X verified, Y drafted-but-failing, Z needs-human, K skipped. Report at `<path>`."
3. Offer to `git diff` the new spec blocks so the user can review the changes.

## Resumability

Any run starts at Phase 0 → Phase 1, then loads `.specify-progress.json` and skips entries with `status: "verified"`. Entries with `status` in `{pending, drafted, failed}` resume mid-loop with the prior attempt count preserved. The user can manually edit `.specify-progress.json` to reset a function's state.

## Operating rules

- **Never auto-edit the user's `Move.toml`.** Surface setup issues; let the user fix them.
- **Never spec a `public(package)` function.** The user's intent (per the plan) is external-API specs only.
- **Never emit legacy MSL syntax.** No `aborts_if`, no `pragma`, no free `axiom`. See `references/spec-patterns.md` for the modern equivalents.
- **Never duplicate a `#[spec(...)]` for the same function.** Idempotency via the marker block.
- **Never strip per-spec `boogie_opt` tokens.** They are load-bearing on hard specs (the AMM `withdraw_spec` uses three).
- **`AskUserQuestion` is the only user-input channel.** No free-form prompts. Batch sub-questions by topic.
- **For document deliverables outside chat, prefer self-contained HTML.** The Phase 5 audit report is the user's record.
