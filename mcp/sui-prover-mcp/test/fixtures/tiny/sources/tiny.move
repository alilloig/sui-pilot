module tiny::math;

const ECapped: u64 = 0;

public fun safe_increment(x: u64): u64 {
    assert!(x < 100, ECapped);
    x + 1
}

// specs

#[spec_only]
use prover::prover::{asserts, ensures};

#[spec(prove)]
fun safe_increment_spec(x: u64): u64 {
    asserts(x < 100);
    let r = safe_increment(x);
    ensures(r == x + 1);
    r
}
