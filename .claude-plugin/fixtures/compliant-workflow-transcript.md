# Compliant Workflow Transcript

This fixture demonstrates the full sui-move-agent workflow: doc lookup before coding,
implementation, and the mandatory skill sequence (quality → review → tests).

---

## Scenario

User asks the sui-move-agent to implement a simple `Counter` object with increment,
decrement, and a read method, along with unit tests.

---

## Transcript

**User:** Implement a `Counter` object in Move 2024 that tracks an integer count. Expose `increment`, `decrement`, and `value` functions. Add unit tests.

---

**sui-move-agent:**

Starting doc lookup before writing any code.

### Step 1 — Read docs/CLAUDE.md

> Read `${CLAUDE_PLUGIN_ROOT}/docs/CLAUDE.md`

Found: preferred module syntax is `module package_name::name;` (no curly braces), edition 2024, capability objects use `Cap` suffix, events use past-tense names.

### Step 2 — Read docs/agents/sui-pilot-agent.md

> Read `${CLAUDE_PLUGIN_ROOT}/docs/agents/sui-pilot-agent.md`

Found: sui-pilot snapshot confirmed via the embedded doc index block; search routing for Sui/Move topics should use `.sui-docs/`.

### Step 3 — Search bundled docs for relevant patterns

> Grep `.sui-docs/` for `owned object` and `object model`

Matched `object-model.md` — confirmed: `Counter` should use an owned object with `key + store` abilities. Shared objects add congestion risk for a simple counter and are not needed here.

> Grep `.sui-docs/` for `entry fun` and `public fun`

Matched `functions.md` — confirmed: `increment` and `decrement` should be `public fun` taking `&mut Counter`; `value` is a pure getter returning `u64`.

---

### Implementation

```move
module counter::counter;

use sui::object::{Self, UID};
use sui::tx_context::TxContext;
use sui::transfer;

public struct Counter has key, store {
    id: UID,
    value: u64,
}

public fun new(ctx: &mut TxContext): Counter {
    Counter {
        id: object::new(ctx),
        value: 0,
    }
}

public fun increment(c: &mut Counter) {
    c.value = c.value + 1;
}

public fun decrement(c: &mut Counter) {
    assert!(c.value > 0, 0);
    c.value = c.value - 1;
}

public fun value(c: &Counter): u64 {
    c.value
}
```

### Step 6 — MCP diagnostics

> `move_diagnostics` called on `sources/counter.move`

Result: no errors, no warnings.

### Step 7 — Local build verification

> `sui move build && sui move test`

Build: OK (0 errors)
Tests: no test files yet — will be addressed after skill sequence.

---

### Step 8a — /move-code-quality

Invoking `move-code-quality` skill on the package.

**Output:**

- ✅ Module syntax uses edition 2024 style (`module package_name::name;`)
- ✅ No `get_` prefix on getter (`value` not `get_value`)
- ✅ Struct abilities are minimal and correct (`key + store`)
- ⚠️ `assert!(c.value > 0, 0)` — use a named error constant instead of bare `0`

**Fix applied:**

```move
const EUnderflow: u64 = 0;

public fun decrement(c: &mut Counter) {
    assert!(c.value > 0, EUnderflow);
    c.value = c.value - 1;
}
```

Re-ran `/move-code-quality` — no remaining issues.

---

### Step 8b — /move-code-review

Invoking `move-code-review` skill on the package.

**Output:**

- ✅ No shared object congestion risk (owned object pattern)
- ✅ No unchecked arithmetic overflow (value is increment-only with u64 ceiling)
- ✅ No capability or admin key exposure
- ⚠️ TST-001: No tests for underflow boundary condition (decrement when value = 0)
- ⚠️ TST-002: No tests for zero-state initialization

TST-* findings noted — will be covered in /move-tests step.

---

### Step 8c — /move-tests

Invoking `move-tests` skill (triggered because: no tests exist + TST-* findings from review).

**Generated tests:**

```move
#[test_only]
module counter::counter_tests;

use counter::counter;
use sui::test_scenario;

#[test]
fun test_new_counter_starts_at_zero() {
    let mut scenario = test_scenario::begin(@0xA);
    {
        let ctx = test_scenario::ctx(&mut scenario);
        let c = counter::new(ctx);
        assert!(counter::value(&c) == 0, 0);
        sui::test_utils::destroy(c);
    };
    test_scenario::end(scenario);
}

#[test]
fun test_increment_increases_value() {
    let mut scenario = test_scenario::begin(@0xA);
    {
        let ctx = test_scenario::ctx(&mut scenario);
        let mut c = counter::new(ctx);
        counter::increment(&mut c);
        counter::increment(&mut c);
        assert!(counter::value(&c) == 2, 0);
        sui::test_utils::destroy(c);
    };
    test_scenario::end(scenario);
}

#[test]
fun test_decrement_decreases_value() {
    let mut scenario = test_scenario::begin(@0xA);
    {
        let ctx = test_scenario::ctx(&mut scenario);
        let mut c = counter::new(ctx);
        counter::increment(&mut c);
        counter::decrement(&mut c);
        assert!(counter::value(&c) == 0, 0);
        sui::test_utils::destroy(c);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = counter::counter::EUnderflow)]
fun test_decrement_underflow_aborts() {
    let mut scenario = test_scenario::begin(@0xA);
    {
        let ctx = test_scenario::ctx(&mut scenario);
        let mut c = counter::new(ctx);
        counter::decrement(&mut c); // should abort: EUnderflow
        sui::test_utils::destroy(c);
    };
    test_scenario::end(scenario);
}
```

> `sui move test`

```
BUILDING counter
Running Move unit tests
[ PASS    ] counter::counter_tests::test_new_counter_starts_at_zero
[ PASS    ] counter::counter_tests::test_increment_increases_value
[ PASS    ] counter::counter_tests::test_decrement_decreases_value
[ PASS    ] counter::counter_tests::test_decrement_underflow_aborts
Test result: OK. Total tests: 4; passed: 4; failed: 0
```

---

### Step 9 — Implementation complete

All skill findings addressed, all tests passing. Implementation done.

---

## Compliance Checklist

| Criterion | Satisfied |
|---|---|
| (a) Doc lookup in `docs/CLAUDE.md` before code | ✅ Step 1 |
| (b) Doc lookup in `docs/agents/sui-pilot-agent.md` index before code | ✅ Step 2 |
| (c) Code implementation after docs | ✅ |
| (d) `/move-code-quality` invoked | ✅ Step 8a |
| (e) `/move-code-review` invoked | ✅ Step 8b |
| (f) `/move-tests` invoked (tests absent + TST-* findings) | ✅ Step 8c |
