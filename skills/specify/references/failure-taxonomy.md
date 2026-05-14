# Failure taxonomy — per-kind repair recipes

Each `findings[].kind` returned by `mcp__sui-prover__prove_package` maps to a documented remediation procedure. Use this file when Phase 4.7 of the `specify` skill needs to surface a fix to the user.

Findings always carry `raw_stdout` / `raw_stderr` as the escape hatch — if a kind doesn't match the recipes below, fall back to surfacing the raw output and asking the user.

## kind: `setup_warning`

**What it means.** The wrapper detected an issue before invoking the prover — typically an explicit `Sui` or `MoveStdlib` dep in the user's `Move.toml`, or a non-2024 edition.

**Remediation.**

- Do **not** auto-edit `Move.toml`. Surface the offending line(s) and the exact change to make.
- Common fix: remove explicit `Sui = { ... }` and `MoveStdlib = { ... }` entries from `[dependencies]` so Sui 1.45+ implicit-dep injection kicks in (the prover relies on it).
- After the user confirms the fix, retry from Phase 4.6 (re-verify only this spec).

## kind: `compile_error` / `parse_error`

**What it means.** The Move compiler rejected the package before verification even started. Usually caused by:

1. The spec block we just wrote references a function or type the compiler can't resolve.
2. The colocated-spec compile bug documented in `.sui-prover-docs/guide/SKILL.md`.
3. A pre-existing issue in the user's source (unrelated to our spec).

**Remediation.**

1. `mcp__move-lsp__move_diagnostics` on the affected file to confirm where the compiler complains.
2. If the diagnostic points at the spec block we just wrote:
   - Re-read `references/spec-patterns.md` §1 for the import shape.
   - Check that every `prover::...` function used in the spec is imported.
   - Check that the function name in the spec matches an actual function in the module.
3. If the diagnostic points at the colocated-spec compile bug, switch to the sidecar package pattern (§3 of spec-patterns).
4. If the diagnostic points at a pre-existing issue, surface it and ask the user — don't try to fix unrelated bugs from inside `specify`.

## kind: `asserts_failed`

**What it means.** The prover thinks the function can abort in a way the spec's `asserts(...)` did not cover.

**Remediation.**

1. Re-read the function body. List every `assert!(cond, EError)` line.
2. Compare to the spec's `asserts(cond)` lines.
3. If a body `assert!` is missing from the spec, add it. The drop-the-error-tag pattern is mechanical (§4.1 of spec-patterns).
4. If the prover identifies an *implicit* abort path the body doesn't `assert!` (e.g. division by zero, vector-out-of-bounds), the spec must add an `asserts(...)` for that path. Use `references/spec-patterns.md` §4.5 for the `bag::contains_with_type` family of cases.

## kind: `ensures_failed`

**What it means.** The prover cannot prove the spec's `ensures(...)` postcondition.

**Remediation.** Two angles — try in order:

1. **Strengthen `requires`.** The function may behave as the `ensures` says, but only under preconditions the spec doesn't yet declare. Look for parameter ranges the body's `assert!` lines imply.
2. **Narrow `ensures`.** Maybe the spec claims more than the body delivers. Read the body line by line and craft the weakest postcondition that still captures the intended behaviour.
3. If neither helps, check whether a callee's spec is too loose. Mark the callee with `no_opaque` (§4.8 of spec-patterns) so the prover sees the actual body instead of the callee's contract.

## kind: `abort_unspecified`

**What it means.** The prover detects an abort path with no matching `asserts(...)`. Often emitted alongside `asserts_failed`.

**Remediation.** Same as `asserts_failed` — add the missing mirror. The prover usually says *which* abort path it found unspecified; quote that hint to the user.

## kind: `no_spec`

**What it means.** The function under verification calls another function that has no `#[spec(prove)]` and no `#[ext(pure)]`. The prover doesn't know what the callee does.

**Remediation.** Three options, present them to the user:

1. **Spec the callee first.** If the callee is `public` or `entry`, it's already on the `specify` queue — bump its priority.
2. **Mark the callee `#[ext(pure)]`** if it really is pure (no state, no abort, deterministic, takes `&T`). Cheap when applicable.
3. **Use `no_opaque` on the *caller* spec** to inline the callee's actual body. See `references/spec-patterns.md` §4.8. This is the right move for internal helpers that aren't part of the external API.

## kind: `timeout`

**What it means.** Boogie couldn't discharge the spec inside the configured `--timeout`. Common on large path explosions.

**Remediation.** In escalation order:

1. **Increase `timeout_seconds`** — start at 60s, try 120s, then 300s.
2. **Add `--split-paths=N`** via `extra_args` (start at 4, try 8). The workshop example uses `--split-paths=4`.
3. **Per-spec `boogie_opt` tuning.** See §4.9 of spec-patterns. Start with `vcsMaxKeepGoingSplits:2`. Keep tokens verbatim across retries.
4. **Narrow the spec.** If three escalations don't help, the spec might be asking the prover to discharge too much in one go. Split into multiple smaller specs (e.g. one for the abort path, one for the functional postcondition).

## kind: `unknown`

**What it means.** The wrapper's parser couldn't match the prover's output to a documented kind. Always surface the `raw_stdout` and `raw_stderr` to the user when this happens.

**Remediation.** Two parallel actions:

1. Help the user interpret the raw output (the LLM is good at this; just show them what the prover said).
2. File a one-line entry against the parser at `mcp/sui-prover-mcp/src/parse-output.ts` so the next release classifies this kind correctly. The skill should suggest this when `unknown` appears more than once in the same run.
