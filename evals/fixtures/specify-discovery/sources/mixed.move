module discovery_test::mixed;

// INCLUDE: bare `public` (cross-package + PTB reachable)
public fun pub_fn(x: u64): u64 { x + 1 }

// EXCLUDE: `public(package)` — not externally reachable per the user's
// specify-scope decision (plan §4).
public(package) fun pub_pkg_fn(x: u64): u64 { x + 2 }

// INCLUDE: `public entry` — both annotations, externally reachable.
public entry fun pub_entry_fn(x: u64): u64 { x + 3 }

// INCLUDE: bare `entry` — PTB-callable.
entry fun entry_only_fn(x: u64): u64 { x + 4 }

// EXCLUDE: private (no visibility token).
fun private_fn(x: u64): u64 { x + 5 }

// EXCLUDE: macro functions are compile-time, not runtime-callable.
public macro fun pub_macro_fn($x: u64): u64 { $x + 6 }

// EXCLUDE: stripped from production bytecode, not externally reachable.
#[test_only]
public fun test_only_pub_fn(x: u64): u64 { x + 7 }

// EXCLUDE: also test-scoped.
#[test]
fun test_fn() {
    let _ = pub_fn(1);
}
