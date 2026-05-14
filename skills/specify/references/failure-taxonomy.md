# Failure taxonomy — per-kind repair recipes

Each `findings[].kind` returned by `mcp__sui-prover__prove_package` maps to a documented remediation procedure. Use this file when Phase 4.7 of the `specify` skill needs to surface a fix to the user.

Findings always carry `raw_stdout` / `raw_stderr` as the escape hatch — if a kind doesn't match the recipes below, fall back to surfacing the raw output and asking the user.

## kind: `verified` / `skipped`

**What they mean.** Information-severity per-spec verdicts from the prover (`✅` and `⏭️` lines). `verified` is the success path; `skipped` is a spec that exists but the prover treats as an opaque axiom (typically `#[spec(skip)]` or `#[spec(skip, target = ...)]`). Neither requires user action.

**Remediation.** None. Surface counts in the Phase 5 report.

## kind: `failed`

**What it means.** A per-spec `❌` failure from the prover's emoji output (1.5.3+). Functionally equivalent to `ensures_failed` or `asserts_failed` from older releases — the more granular legacy kinds still fire when the prover emits the older free-form output.

**Remediation.** Same as `ensures_failed` (see below): try strengthening preconditions first, then narrowing the postcondition, then `no_opaque` on a loose callee.

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

## kind: `dep_address_conflict`

**What it means.** The package's address graph assigns the same named address to two different concrete values. The prover's stdout looks like:

```
Unable to resolve named address 'utilities' in package 'AftermathAmmMath' when resolving dependencies in dev mode

Caused by:
    Conflicting assignments for address 'utilities': '0x73baa782c5…' and '0x10'.
```

**Remediation.** Inspect `Move.toml` and dep `Move.toml`s for duplicate `[addresses]` entries with different values for the same name. Reconcile (usually by removing the override in the calling package, or by pinning the dep to the right rev). The prover can't build until exactly one concrete address per name is in scope.

## kind: `unresolved_named_address` / `unresolved_module`

**What they mean.** The Move compiler can't resolve a named address in `[addresses]` or an imported module path. The dep was either never declared in `[dependencies]` or the dep's `Move.toml` doesn't export the expected name.

**Remediation.** Check `Move.toml`'s `[dependencies]` and `[addresses]` sections. For dep-supplied addresses, the dep's own `[addresses]` block declares them — verify the dep is reachable via Phase 0 step 3 and that the address name matches what the dep publishes.

## kind: `dep_fetch_failure`

**What it means.** A git dependency couldn't be cloned. Common causes: private repo + no local SSH access, network failure, typo in the git URL. Stdout typically contains `Repository not found` or `fatal: Could not read from remote repository`.

**Remediation.**

1. Re-run Phase 0 step 3 (dep-reachability gate) with the surfaced URL.
2. Confirm the local SSH identity has read access (`ssh -T git@github.com` for GitHub).
3. If the repo is private and access is unavailable, substitute a local clone via `[dependencies.NAME]` with `local = "<path>"`. **Watch for `dep_address_conflict`** afterward — a local clone with its own `[addresses]` can introduce conflicts with the calling package.
4. As a last resort for stubbed/closed-source deps, use the **sidecar axiom file** pattern from §4 of `spec-patterns.md`.

## kind: `function_not_found`

**What it means.** The `target_function` passed to `prove_package` doesn't match any spec in the compiled package. Stdout: `Function \`pkg::mod::name\` does not exist`.

**Remediation.**

1. Confirm the source file actually contains a `#[spec(prove)] fun <name>_spec(...)` block — sui-prover targets the spec function, not the function under test. The naming convention is `<fn>_spec`; for `target_function: "pkg::mod::foo"`, the spec must be named `pkg::mod::foo_spec`.
2. Confirm the package built successfully on the previous run (a stale build cache can leave the prover targeting an older symbol table).
3. If the spec lives in a sidecar axiom file with `#[spec(target = pkg::mod::foo)]`, target the spec function's name (`<sidecar>::foo_spec`), not the original function.

## kind: `spec_target_body_no_call`

**What it means.** A spec function annotated `#[spec(target = X)]` must call `X` somewhere in its body — the prover's bytecode-transformation phase enforces this so the spec composes with the callee's actual semantics. The error:

```
error: Spec function `specify_axioms::mul_up_spec` should call target function `fixed::mul_up`
```

**Remediation.** Two choices:

1. **Make the spec call the target.** Add a call to `X` in the body, using `fresh()` for inputs you don't care about (the prover treats unconstrained `fresh()` symbolically):
   ```move
   #[spec(prove, target = fixed::mul_up)]
   fun mul_up_spec(a: u256, b: u256): u256 {
       let r = fixed::mul_up(a, b);
       // ensures(...)
       r
   }
   ```
2. **Use `skip` to mark as an opaque axiom** — preferred when the target is a stub or you don't want to verify its body, just use the spec as the contract substituted at call sites:
   ```move
   #[spec(skip, target = fixed::mul_up)]
   fun mul_up_spec(_a: u256, _b: u256): u256 { fresh() }
   ```

The `#[spec(skip, target = ...)]` form is the canonical idiom for axiomatizing stub callees — see `spec-patterns.md` §4 for the full sidecar-axiom-file pattern.

## kind: `no_specs_to_prove`

**What it means.** Info-severity finding (not an error). The package built cleanly but no `#[spec(prove)]` block was found. The prover prints `🦀 No specifications are marked for verification. Nothing to verify.` and exits 0.

**Remediation.** Expected on the very first run of `/specify` against a greenfield package — Phase 3+ will add specs and the next prove call will find them. If this fires *after* Phase 4 has emitted spec blocks, it usually means the build cache is stale; `sui move build` to refresh, then retry.

## kind: `unknown`

**What it means.** The wrapper's parser couldn't match the prover's output to a documented kind. Always surface the `raw_stdout` and `raw_stderr` to the user when this happens.

**Remediation.** Two parallel actions:

1. Help the user interpret the raw output (the LLM is good at this; just show them what the prover said).
2. File a one-line entry against the parser at `mcp/sui-prover-mcp/src/parse-output.ts` so the next release classifies this kind correctly. The skill should suggest this when `unknown` appears more than once in the same run.
