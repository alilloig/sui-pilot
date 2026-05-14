module integer_mate::math_u256;

#[spec_only]
use prover::prover::{ensures, requires};


public fun checked_shlw(n: u256): (u256, bool) {
    let mask = 0xffffffffffffffff << 192;
    if (n > mask) {
        (0, true)
    } else {
        ((n << 64), false)
    }
}

#[spec(prove)]
public fun checked_shlw_spec(n: u256): (u256, bool) {
    let (result, overflow) = checked_shlw(n);
    let n_shifted = n.to_int().shl(64u64.to_int());
    if (result.to_int() != n_shifted) {
        ensures(overflow == true);
    } else {
        ensures(overflow == false);
    };
    (result, overflow)
}

public fun checked_shlw_buggy(n: u256): (u256, bool) {
    let mask = 0xffffffffffffffff << 192;
    if (n > mask) {
        (0, true)
    } else {
        ((n << 64), false)
    }
}

public fun checked_shlw_buggy_fix(n: u256): (u256, bool) {
    let mask = 1 << 192;
    if (n > mask) {
        (0, true)
    } else {
        ((n << 64), false)
    }
}

public fun checked_shlw_correct(n: u256): (u256, bool) {
    let mask = 1 << 192;
    if (n >= mask) {
        (0, true)
    } else {
        ((n << 64), false)
    }
}

#[spec(prove)]
public fun checked_shlw_buggy_spec(n: u256): (u256, bool) {
    let (result, overflow) = checked_shlw_buggy(n);
    ensures(overflow == (result.to_int() != n.to_int().shl(64u64.to_int())));
    (result, overflow)
}

#[spec(prove)]
public fun checked_shlw_buggy_fix_spec(n: u256): (u256, bool) {
    let (result, overflow) = checked_shlw_buggy_fix(n);
    ensures(overflow == (result.to_int() != n.to_int().shl(64u64.to_int())));
    (result, overflow)
}

#[spec(prove)]
public fun checked_shlw_spec_correct(n: u256): (u256, bool) {
    let (result, overflow) = checked_shlw_correct(n);
    ensures(overflow == (result.to_int() != n.to_int().shl(64u64.to_int())));
    (result, overflow)
}
