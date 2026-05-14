# Spec authoring patterns

Distilled from `.sui-prover-docs/guide/SKILL.md`, `.sui-prover-docs/guide/spec-reference.md`, and the working examples in `.sui-prover-docs/examples/`. Refer back to those for primary sources.

## 1. Visibility classification regex

`move_document_symbols` does **not** return visibility — every function comes back as `kind: 'function'`. The `specify` skill classifies visibility via comment-stripped regex over the `.move` source. The contract:

```js
// Group 1: leading visibility/qualifier tokens (trimmed)
// Group 2: function name
const FN_DECL = /^(?:\s*#\[[^\]]*\][^\n]*\n)*\s*((?:public(?:\(package\))?\s+)?(?:entry\s+)?(?:native\s+|macro\s+)?)fun\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
```

Classification rules:

- `public(package)` → **excluded** (skill scope: external API only).
- `public` (no `(package)`) → included.
- `entry` (with or without `public`) → included.
- `native` `public` → included; native bodies are opaque but specs are still valid via `requires` / `ensures`.
- `macro` → excluded (compile-time, not runtime-callable).
- private `fun` (no visibility token) → excluded.

Attribute exclusion for `#[test_only]` / `#[test]`:

- The `FN_DECL` regex already consumes any leading `#[...]` attribute block via the `(?:\s*#\[[^\]]*\][^\n]*\n)*` prefix, so `match[0]` (the whole match) covers the attribute *and* the `fun NAME` declaration.
- **Implementation:** test `match[0]` itself for `/#\[\s*(?:test_only|test)\b/`. If it matches, exclude the function.
- **Do NOT** scan backward from `match.index` — that points to the start of the attribute block, not the `fun` keyword, so any look-behind from there picks up content that belongs to the *previous* function and produces false negatives on the function under inspection.
- **Do NOT** use a fixed character window (e.g. 200 chars). The naive form over-matches: a `#[test_only]` 3 lines earlier taints all subsequent functions in the file.

## 2. Canonical spec body shape

The minimal twin function pattern (from `.sui-prover-docs/guide/SKILL.md`):

```move
#[spec(prove)]
fun <name>_spec(<params>): <return_type> {
    requires(<precondition>);
    let __old = clone!(<mutable_ref>);     // only when capturing pre-state
    asserts(<abort_condition>);             // mirror each `assert!(cond, EError)` minus the error tag
    let <r> = <name>(<args>);
    ensures(<postcondition>);
    <r>
}
```

Imports live in a `#[spec_only]` block at the bottom of the file. **Always tag the import block `#[spec_only]`** so it gets stripped from production bytecode:

```move
#[spec_only]
use prover::prover::{requires, ensures, asserts, clone};
#[spec_only]
use prover::ghost::{declare_global, global};   // only when using ghost state
```

## 3. The colocation-vs-sidecar choice

The Asymptotic SKILL.md warns:

> Specs may cause compile errors when placed alongside regular Move code due to prover-specific changes in the compilation pipeline. If this happens, create a separate package for specs and use the `target` attribute.

Workflow:

1. Try colocation first (it's what every example in `.sui-prover-docs/examples/` does).
2. If the compile fails *only* after the spec block is written, fall back to a sidecar package `<pkg>_specs/`:

   ```move
   module <pkg>_specs::<mod>;

   #[spec(prove, target = <pkg>::<mod>::<fn>)]
   public fun <fn>_spec(<params>): <return_type> {
       <pkg>::<mod>::<fn>(<args>)
       // requires / ensures / asserts as usual
   }
   ```

3. The skill must ask the user (`AskUserQuestion`) before creating files outside the user's package directory.

## 4. Common patterns

### 4.1 Mirroring `assert!` aborts

Source:
```move
public fun set_fees(lp_fee_bps: u64) {
    assert!(lp_fee_bps < BPS_IN_100_PCT, EInvalidFeeParam);
    // ...
}
```

Spec — drop the error tag, keep the predicate:
```move
#[spec(prove)]
fun set_fees_spec(lp_fee_bps: u64) {
    asserts(lp_fee_bps < BPS_IN_100_PCT);
    set_fees(lp_fee_bps);
}
```

### 4.2 Overflow handling

`u64` arithmetic that could overflow needs Integer math (lifts to unbounded integers). Source:
```move
public fun add(x: u64, y: u64): u64 { x + y }
```

Spec:
```move
#[spec(prove)]
fun add_spec(x: u64, y: u64): u64 {
    requires(x.to_int().add(y.to_int()).lte(MAX_U64.to_int()));
    let r = add(x, y);
    ensures(r.to_int() == x.to_int().add(y.to_int()));
    r
}
```

### 4.3 Capturing pre-state for `&mut` parameters

Source:
```move
public fun deposit(pool: &mut Pool, amount: u64) {
    pool.balance = pool.balance + amount;
}
```

Spec uses `clone!`:
```move
#[spec(prove)]
fun deposit_spec(pool: &mut Pool, amount: u64) {
    let __old = clone!(pool);
    requires(__old.balance.to_int().add(amount.to_int()).lte(MAX_U64.to_int()));
    deposit(pool, amount);
    ensures(pool.balance == __old.balance + amount);
}
```

### 4.4 Quantifiers — named pure helpers required

Lambdas inside `forall!` / `exists!` must call a named `#[ext(pure)]` function. Inline expressions like `|x| *x + 10` are NOT supported.

```move
#[ext(pure)]
fun is_positive(x: &u64): bool { *x > 0 }

#[spec(prove)]
fun all_positive_spec(v: &vector<u64>): bool {
    let r = all_positive(v);
    ensures(r == forall!(v, |x| is_positive(x)));
    r
}
```

### 4.5 `bag::contains` vs `bag::borrow`

`bag::contains<K>` does **not** discharge the abort condition of `bag::borrow<K, V>`. Always use `bag::contains_with_type<K, V>` when the function under spec calls `bag::borrow<K, V>`.

### 4.6 Loop invariants

When a spec touches a variable modified inside a loop, an `invariant!` is required:

```move
#[spec(prove)]
fun sum_spec(v: &vector<u64>): u64 {
    let r = sum(v);
    invariant!(|| { /* relation between accumulator and partial result */ });
    ensures(r == /* expected closed form */);
    r
}
```

### 4.7 Ghost state for events

If the function under spec emits an event and the spec needs to reason about it. The helper that mirrors the emit stays a plain `fun` -- do NOT add `#[ext(pure)]`, the body has the `event::emit` side effect that `pure` forbids:

```move
fun emit_large_withdraw_event() {
    event::emit(LargeWithdrawEvent {});
    requires(*global<LargeWithdrawEvent, bool>());
}

#[spec(prove)]
fun withdraw_spec<T>(pool: &mut Pool<T>, shares: Balance<LP<T>>): Balance<T> {
    declare_global<LargeWithdrawEvent, bool>();
    let r = withdraw(pool, shares);
    if (r.value() >= LARGE_WITHDRAW_AMOUNT) {
        ensures(*global<LargeWithdrawEvent, bool>());
    };
    r
}
```

### 4.8 `no_opaque` — see through the callee

By default, the prover treats each function as opaque (uses its spec contract only). When the caller's spec needs to see the callee's actual body:

```move
#[spec(prove, no_opaque)]
fun foo_spec(x: &mut u8) { foo(x); }   // forces inlining of foo's body

#[spec(prove)]
fun bar_spec(x: &mut u8) {
    bar(x);
    ensures(*x == 70);   // discharges because foo_spec is no_opaque
}
```

### 4.9 Per-spec `boogie_opt` tuning

For hard specs (large path explosion), tune Boogie's VC-splitter directly. The AMM uses these on three of its hardest specs:

```move
#[spec(prove, boogie_opt = b"vcsMaxKeepGoingSplits:2 vcsSplitOnEveryAssert vcsFinalAssertTimeout:600")]
fun withdraw_spec<A, B>(pool: &mut Pool<A, B>, lp_in: Balance<LP<A, B>>): (Balance<A>, Balance<B>) { ... }
```

**Never strip these tokens** during spec rewrites. They're load-bearing — without them the spec times out.

### 4.10 Axiomatic modeling of stub callees

Real-world Move packages often depend on libraries whose **source isn't shipped** — the dep's public-bytecode interface is exported but every function body is `abort 0` (the canonical stub shape used when a vendor publishes the ABI but keeps the implementation closed). A prover invoked on such a package concludes every caller path aborts (because every callee aborts), so any spec verifies *vacuously*: the `_Check` and `_Assume` subchecks pass but say nothing about the real math.

The fix is **axiomatic modeling** of the stub callees via a dedicated sidecar file `sources/specify_axioms.move`:

```move
module <pkg>::specify_axioms;

#[spec_only]
use prover::prover::{fresh};
use utilities::fixed;

// Opaque summary: skip tells the prover not to verify the body; target =
// registers this function as the abstract contract substituted at every
// call site of the target. `fresh()` returns an unconstrained symbolic value
// — the prover knows nothing more than the function's signature.
#[spec(skip, target = fixed::mul_down)]
fun mul_down_spec(_a: u256, _b: u256): u256 { fresh() }

#[spec(skip, target = fixed::mul_up)]
fun mul_up_spec(_a: u256, _b: u256): u256 { fresh() }

#[spec(skip, target = fixed::ln)]
fun ln_spec(_x: u256): u256 { fresh() }

#[spec(skip, target = fixed::exp)]
fun exp_spec(_x: u256): u256 { fresh() }
```

Then write the real spec normally in the target file:

```move
#[spec(prove, ignore_abort)]
fun calc_invariant_full_spec(
    balances: &vector<u128>,
    weights: &vector<u64>,
): u256 {
    let r = calc_invariant_full(balances, weights);
    // ensures(r matches the math you actually care about)
    r
}
```

The prover substitutes the axioms' `fresh()` results at every `fixed::mul_down` / `fixed::ln` / etc. call site inside `calc_invariant_full`, so verification reasons about *symbolic* fixed-point values — not about `abort 0`. The spec doesn't *prove* the real math, but it does prove the spec's structural claims (typing, modular composition, abort behavior) hold under any valid implementation of the stub interface. That's the strongest verification possible without the dep's source.

**When to use:**

- Any dep with `abort 0` bodies for every public function.
- Closed-source math packages (fixed-point libs, oracle clients).
- Performance-critical native functions where the Move impl is a `native fun` stub.

**Caveats:**

- The `skip` attribute prevents the axiom body from being verified — that's the point, since `fresh()` has no postcondition. Don't use `skip` for functions you *do* want verified.
- The `#[spec(target = X)]` requires the spec function's body to actually call `X` *unless* `skip` is also set. The combined `#[spec(skip, target = X)]` form sidesteps that requirement (see failure-taxonomy entry for `spec_target_body_no_call`).
- Add `ensures(...)` only if you can state a property the real implementation *must* satisfy regardless of internals (e.g., `mul_down(a, 0)` must equal `0`). Bare `fresh()` axioms are the safest starting point.

This pattern was discovered during the `move-amm-public` evaluation when the agent observed the `utilities::fixed` source was a stub and the naïve approach (replacing stub bodies with placeholders) silently weakened the verification. The sidecar form makes the axiomatization explicit and reviewable.

## 5. Legacy MSL — DO NOT emit

The Sui Prover does **not** use the legacy Move Prover MSL keywords. Common drift to avoid:

| Don't emit | Use instead |
|---|---|
| `aborts_if cond` | `asserts(cond)` (positive form — "aborts unless cond") |
| `pragma X = Y` | attribute params: `#[spec(prove, X)]` or `#[ext(...)]` |
| `apply X to ...` | `#[spec(prove, include = <path>)]` |
| `assume cond` | put `cond` in `requires(...)` — there is no separate `assume` |
| free `axiom { ... }` | `#[ext(axiom)]` on a function or `#[spec_only(axiom)]` |
| `invariant <expr>` block | `invariant!` macro (loops) or `<Type>_inv` naming + `#[spec_only(inv_target = T)]` (data invariants) |

If a user pastes legacy MSL into a spec the skill is reviewing, surface this table and ask whether to translate or abort.
