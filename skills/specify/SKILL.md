---
name: specify
description: "Walks the user through writing `#[spec(prove)]` formal specifications for every externally reachable function (`public` non-package + `entry`) in their Sui Move package, drives sui-prover via the sui-prover-mcp, and iterates on failures using a documented taxonomy. Use this skill when the user invokes `/specify`, asks to 'add formal verification', 'write prover specs', 'verify this package with sui-prover', or wants to harden a Move package before mainnet deploy. Skip for `public(package)` or private functions (out of scope), or when sui-prover isn't installed. Complements /move-code-review (SEC-* findings indicate where specs matter most) and /move-tests (specs are static guarantees, tests are dynamic samples)."
---

# Specify — formal specifications for Sui Move

> **Doc-First Requirement.** Read `.sui-prover-docs/` before drafting any spec. The Sui Prover spec language is **not** the legacy Move Prover MSL — it uses `#[spec(prove)]`, `requires`, `ensures`, `asserts` (positive abort form), and the macros `clone!`, `forall!`, `exists!`, `invariant!`. It does NOT use `aborts_if`, `pragma`, `apply`, `assume`, or free `axiom`. Verify any construct against `.sui-prover-docs/guide/spec-reference.md` before emitting it.

## Non-interactive (eval) mode

This skill is **interactive by default** — every gate runs through `AskUserQuestion`. Non-interactive mode activates via **either** of two triggers:

1. **Environment-flag trigger.** Before doing anything else, run `echo "${SPECIFY_AUTO_DEFAULTS:-}"` via Bash. If the output is exactly `1`, this run is in non-interactive mode (typically because `evals/run-comparison.sh` or a similar headless rig is driving it).
2. **Verbal-directive trigger.** The user has explicitly said something like *"don't stop"*, *"don't pause"*, *"work autonomously"*, *"no questions"*, *"proceed without asking"*, or *"no-pause"* in the current conversation. A `Stop` hook with an autonomy-oriented condition counts as such a directive.

When non-interactive mode is active:

- **Skip every `AskUserQuestion` gate.** Pick the first option (the suggested default) and announce the choice in plain text instead.
- **Surface a single-line acknowledgement in chat** the first time you enter the non-interactive branch: *"Entering non-interactive mode (trigger: <env-flag | verbal-directive>) — picking defaults at every gate."* The elision must be auditable; never skip an `AskUserQuestion` silently.
- **Abort hard on any `setup_warning` of severity error.** Don't surface "proceed anyway" — write the warning to `.specify-report.html`, exit Phase 0, and return. (Warnings of severity `info` like `private_dependency` advisories surface in the report but don't abort.)
- **Cap iterations at 1.** The Phase 4 loop tries once per function; failures get marked `needs_human` immediately instead of looping. Eval harnesses care about the discovery + draft signal, not multi-attempt convergence.
- **Cap prioritization batch.** Process every pending function in default priority order — no user picks.
- **Persist progress as usual.** `.specify-progress.json` and `.specify-report.html` must still land at the package root so the eval scorer can read them.

Interactive mode (neither trigger active) is the default — every gate runs normally.

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

Phase 0 is a **hard gate**. If any of the four checks below surfaces an error, write the diagnostic to `.specify-progress.json` (with structured `blocker.kind`) and `.specify-report.html`, then exit — do not proceed to Phase 1. The cost of running Phase 1's discovery sweep on an un-buildable package is wasted budget; the LSP and dep-reachability checks here cost <1s and save minutes downstream.

1. **Binary probe.** Call `mcp__sui-prover__prover_capabilities` with `move_toml_path` set to the user's package root. Read the response: `binary.found`, `binary.sui_prover_flags` (the flag list belongs to **sui-prover**, not `sui move build` — don't forward it to the Sui CLI), `setup_warnings`, `git_dependencies`.

2. **Compile-health gate.** Call `mcp__move-lsp__move_diagnostics` with `scope: 'file'` on any one `.move` file under `sources/`. **If it returns any `severity: 'error'` diagnostic referencing `unresolved external module`, `unresolved named address`, `unbound module`, or a git-fetch failure**, the package is un-buildable as-is — record `blocker.kind = "compile_unresolvable"` and exit Phase 0. Do not proceed to function inventory until diagnostics return at least one resolvable file.

3. **Dep-reachability gate** (interactive: prompt; non-interactive: warn + continue). For each entry in `git_dependencies`, run `git ls-remote --exit-code --quiet <url> HEAD` with a 3s timeout. Unreachable URLs (auth failure, repo missing, timeout) are likely private repos the local SSH identity can't access — surface them as `setup_warnings` of kind `private_dependency` and either prompt the user (Option A: grant access, B: substitute a local clone via `[dependencies.NAME]` with `local = "..."`, C: skip the package, D: proceed anyway) or, in non-interactive mode, record the unreachable list in `.specify-progress.json` under `blocker.unreachable_deps[]` and continue with a soft warning. **The single most common /specify blocker on real packages is private-dep unreachability — surface it before Phase 1's inventory sweep.**

4. **Binary missing.** If `binary.found === false`:
   - **Interactive mode**: STOP, ask the user to `brew install asymptotic-code/sui-prover/sui-prover`.
   - **Non-interactive mode** (`SPECIFY_AUTO_DEFAULTS=1` or verbal-directive): enter **discovery-only** mode — Phase 1 still runs and writes `.specify-progress.json` (so eval rigs like `task-28-specify-discovery` get the function set on a runner that lacks the binary); skip the per-function prove loop (Phase 4.6) entirely; mark every discovered function with `status: "discovery_only"` in the progress file; emit a `.specify-report.html` noting the binary was absent; exit cleanly.

5. **setup_warnings.** If `setup_warnings` is non-empty (explicit `Sui`/`MoveStdlib` deps, non-2024 edition, private deps surfaced by step 3):
   - Surface every warning verbatim.
   - **AskUserQuestion (single batch)**: "fix Move.toml myself first / proceed anyway (specs may not compile) / abort". Default suggestion: "fix first".
   - **Non-interactive mode**: abort hard (per the contract at the top of this file); the eval harness needs a deterministic exit.
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

## Phase 1.5 — Scope decision + callee-quality probe

Before launching Phase 2's per-function loop, two cheap checks decide *what* gets specified and *how rigorously*:

**(a) Scope decision.** If `N > 25`, ask the user how to scope:

- **AskUserQuestion (single batch)**, options: "spec the whole package (large — may take a session) / pick a prioritized subset (recommended, default) / pick a single module to start with / single function".
- **Non-interactive mode**: pick "prioritized subset" using the Phase 3 ranking (invariant > swap > deposit/withdraw > getters > admin caps). Codify the heuristic instead of improvising; the eval harness needs reproducible scope.
- For *math kernel* packages with an `invariant`-named function family, the invariant is almost always the right first target — it's the smallest atomic spec and every downstream swap/deposit/withdraw spec depends on its semantics.

**(b) Callee-quality probe.** Before drafting any spec, sample the callees called inside the target functions:

1. For each external callee not already in the target set, `Read` its source.
2. If every public function body in the callee's module is `abort 0` or `native`, the module is a **stub** — its bytecode interface is published but the real source isn't shipped (common with `published-at` deps and proprietary fixed-point math packages).
3. **If any stub callee is detected**, surface it in `.specify-progress.json` under `callee_quality[]` and warn the user: *"Module `<X>` is a stub (every body is `abort 0`). Specifying functions that call into it requires axiomatic modeling — see `references/spec-patterns.md` §4.10 — or every verification will be vacuous (the prover concludes every caller path aborts)."*

The right escape is the canonical `#[spec(skip, target = <stub_fn>)]` idiom documented in `references/spec-patterns.md` §4.10 and Phase 4.5 below.

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

**Sidecar axiom file** (recommended when the package has stub callees, large axiom counts, or any cross-package targets). Instead of inlining axiom declarations next to every spec block, create `sources/specify_axioms.move` inside the target package:

```move
module <pkg>::specify_axioms;

#[spec_only]
use prover::prover::{fresh};
use utilities::fixed;

// Opaque summaries for stub callees. `skip` tells the prover not to verify
// the body; `target = …` registers this function as the abstract contract
// substituted at call sites of the target.
#[spec(skip, target = fixed::mul_down)]
fun mul_down_spec(_a: u256, _b: u256): u256 { fresh() }

#[spec(skip, target = fixed::ln)]
fun ln_spec(_x: u256): u256 { fresh() }
```

This is the canonical way to axiomatize external/stubbed dependencies. Specs in the target file then reference the real callees naturally and the prover substitutes the spec summaries. See `references/spec-patterns.md` §4.10 for the full pattern.

**Cross-module fallback.** If the colocated spec causes a compile error, offer to create a sidecar `<pkg>_specs/` package and emit the spec there with `target = pkg::mod::fn`. **AskUserQuestion before creating files outside the user's package directory.**

### 4.6 Verify (MCP)

`mcp__sui-prover__prove_package` with `target_function: "<pkg>::<mod>::<name>_spec"` and `timeout_seconds: 60` (configurable).

### 4.7 Diagnose failures

If `findings` contains a failure for this spec, consult `references/failure-taxonomy.md` — each `findings[].kind` maps to a documented remediation. Common kinds:

- `ensures_failed` → narrow postcondition or strengthen preconditions
- `asserts_failed` → missing/incorrect mirror of an `assert!`
- `abort_unspecified` → add an `asserts()` for an implicit abort path
- `timeout` → try `--split-paths`, then per-spec `boogie_opt` tuning
- `no_spec` on a callee → spec that callee first, or add `no_opaque` to bypass
- `spec_target_body_no_call` → spec function with `#[spec(target = X)]` must call `X` in its body, or use `#[spec(skip, target = X)]` for an opaque axiom
- `dep_address_conflict` → duplicate `[addresses]` entries; reconcile in `Move.toml`
- `unresolved_named_address` / `unresolved_module` → missing entry in `[addresses]` or `[dependencies]`
- `dep_fetch_failure` → private repo or network failure (rerun Phase 0 step 3)
- `function_not_found` → `target_function` doesn't match any spec in the package (typo, or stale build cache; the spec must follow the `<fn>_spec` naming convention)
- `no_specs_to_prove` → the package compiled but no `#[spec(prove)]` block exists yet (expected on the first run; abnormal after Phase 3)

Use `summary.overall` (one of `verified_all` / `failed_some` / `no_specs` / `compile_failure` / `timeout` / `error`) as the single trustworthy "did this run succeed?" signal — don't try to reconcile `summary.verified === 0` with `findings.length > 0` yourself, the MCP already did it.

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
- **Never delete downstream tasks on a Phase 0 blocker.** If `/specify` hits a hard blocker (unreachable deps, compile failure, missing binary), leave queued Phase 2–4 tasks as `pending` or move them to a `blocked` status — the resumption breadcrumb in `.specify-progress.json` must stay coherent with the session task list so the user can resume cleanly after fixing the blocker.
- **`AskUserQuestion` is the only user-input channel.** No free-form prompts. Batch sub-questions by topic.
- **For document deliverables outside chat, prefer self-contained HTML.** The Phase 5 audit report is the user's record.
