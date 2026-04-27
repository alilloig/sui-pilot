---
name: move-tests
description: |
  Generates Move unit tests for Sui Move packages following best practices.
  Use this skill when the user asks to "write Move tests", "add tests", "create
  test cases", "generate tests for this module", "test this Move code", or wants
  to improve test coverage for a Sui Move package. Also trigger when the user
  says "move tests", "unit tests for Move", "test coverage", or "/move-tests".
  Complements /move-code-review (which identifies test gaps via TST-* findings)
  and /move-code-quality (which checks test quality). This skill fills the gap
  by prescribing HOW to write the tests.
---

# Move Tests

> **Doc-First Requirement**: Before generating test code, verify current testing patterns against the sui-pilot documentation (`.sui-docs/`, `.move-book-docs/`, `.walrus-docs/`, `.seal-docs/`, `.ts-sdk-docs/`). The full pipe-delimited index lives in `agents/sui-pilot-agent.md`. Test utilities and conventions evolve—`test_scenario`, `tx_context::dummy()`, and assertion helpers may have changed. When using specific test APIs, reference the doc file path.

## File Organization

Tests live in the `tests/` directory at the package root, **not** in `sources/`. Name test files after the module or domain they cover.

```
my_package/
├── sources/
│   ├── pool.move
│   └── oracle.move
├── tests/
│   ├── pool_tests.move
│   └── oracle_tests.move
├── Move.toml
└── Move.lock
```

Inside `sources/`, only include `#[test_only]` helper functions (like `init_for_testing`). Actual test functions go in `tests/`.

## Only Test Public Functions

Tests should only call `public` and `entry` functions — the same entry points available to external callers. **Never call `public(package)` or private (`fun` without `public`) functions directly from tests.** These are internal to the package and not part of the external API; testing them directly couples tests to implementation details and bypasses the intended access boundaries. If a behavior is only reachable through an internal function, test it indirectly through the `public` or `entry` function that calls it.

## Avoid test_scenario When Not Needed

`test_scenario` simulates multi-transaction, multi-sender flows. It adds boilerplate and overhead. **Only use it when you actually need multiple transactions or senders.**

For most unit tests, use a simple `&mut TxContext` from `tx_context::dummy()`:

```move
#[test]
fun test_create_pool() {
    let mut ctx = tx_context::dummy();
    let pool = pool::new(&mut ctx);
    // assert on pool state
    std::unit_test::destroy(pool);
}
```

Use `test_scenario` only when you need:
- Multi-transaction flows (`next_tx`)
- Multiple senders
- Object retrieval across transactions (`take_from_sender`, `take_shared`)

## init_for_testing Pattern

If your tests call a module that has an `init` function, that module must expose a `#[test_only]` initialization wrapper. The `init` function runs automatically on publish and cannot be called directly in tests.

```move
module my_package::registry;

fun init(ctx: &mut TxContext) {
    let registry = Registry { id: object::new(ctx), entries: table::new(ctx) };
    transfer::share_object(registry);
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx);
}
```

Then in tests:

```move
#[test]
fun test_registry() {
    let mut scenario = test_scenario::begin(@0x1);
    registry::init_for_testing(scenario.ctx());

    scenario.next_tx(@0x1);
    let registry = scenario.take_shared<Registry>();
    // test logic
    test_scenario::return_shared(registry);

    scenario.end();
}
```

## Helper Functions

When you see repeated setup or assertion patterns across tests, extract them into `#[test_only]` helpers. Suffix them with `_for_testing` to distinguish from production code.

```move
#[test_only]
public fun create_pool_for_testing(ctx: &mut TxContext): Pool {
    let mut pool = pool::new(ctx);
    pool.add_liquidity(coin::mint_for_testing<SUI>(1_000_000, ctx));
    pool
}

#[test]
fun test_swap() {
    let mut ctx = tx_context::dummy();
    let mut pool = create_pool_for_testing(&mut ctx);
    let coin_out = pool.swap(coin::mint_for_testing<USDC>(100, &mut ctx));
    assert!(coin::value(&coin_out) > 0);
    std::unit_test::destroy(pool);
    std::unit_test::destroy(coin_out);
}
```

## Cleanup

Non-droppable objects must be consumed at end of test. Use `std::unit_test::destroy` as a catch-all for cleanup in tests. Never use `destroy` in production code.

For `test_scenario`, always call `scenario.end()` at the end.

## Test Expected Failures

Use `#[expected_failure]` to verify that code aborts under the right conditions. Always specify the abort code to avoid false passes.

```move
#[test, expected_failure(abort_code = pool::EInsufficientLiquidity)]
fun test_swap_empty_pool_fails() {
    let mut ctx = tx_context::dummy();
    let mut pool = pool::new(&mut ctx);
    let coin_out = pool.swap(coin::mint_for_testing<SUI>(100, &mut ctx));
    std::unit_test::destroy(pool);
    std::unit_test::destroy(coin_out);
}
```

## Useful Testing Utilities

| Module | Function | Purpose |
|--------|----------|---------|
| `std::unit_test` | `destroy` | Black-hole for cleaning up any value in tests |
| `sui::coin` | `mint_for_testing` | Create coins with arbitrary value |
| `sui::coin` | `burn_for_testing` | Destroy coins in tests |
| `sui::test_utils` | `create_one_time_witness_for_testing` | Create OTW outside of `init` |
| `std::unit_test` | `assert_eq!` / `assert_ref_eq!` | Better error messages than `assert!` |
| `std::debug` | `print` | Debug printing during tests |

## Coverage

After writing tests, run with coverage and trace:

```bash
sui move test --trace --coverage
```

Then print the summary:

```bash
sui move coverage summary
```

Read the output. If overall or any module coverage is below 80%, add more tests. Target the uncovered lines by inspecting specific modules:

```bash
sui move coverage source --module <MODULE_NAME>
```

Uncovered lines are highlighted. Write tests that exercise those paths until coverage is above 80%.

### Coverage Commands Reference

| Command | Purpose |
|---------|---------|
| `sui move test --coverage --trace` | Run tests, collect coverage + trace data |
| `sui move coverage summary` | Coverage % per module |
| `sui move coverage summary --summarize-functions` | Coverage % per function |
| `sui move coverage source --module <NAME>` | Line-by-line coverage for a module |
| `sui move coverage lcov` | Generate LCOV report for CI/editor integration |
