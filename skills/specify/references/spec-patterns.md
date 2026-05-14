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

Attribute look-behind for `#[test_only]` / `#[test]` / `#[allow(...)]`:

- Scan back **only** to the previous non-empty, non-attribute line — not a fixed character window.
- If any attribute on the immediately preceding `#[...]` block matches `test_only` or `test`, exclude the function.
- This matters because the naive 200-char look-behind over-matches: a `#[test_only]` 3 lines earlier taints all subsequent functions in the file.

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

If the function under spec emits an event and the spec needs to reason about it:

```move
#[ext(pure)]
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
