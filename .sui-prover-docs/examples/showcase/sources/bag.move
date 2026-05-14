module showcase::bag;

use prover::prover::{requires, ensures};

use sui::bag;

fun foo(x: &mut bag::Bag) {
    *(x.borrow_mut(10u64)) = 0;
}

#[spec(prove)]
fun foo_spec(x: &mut bag::Bag) {
    requires(x.contains_with_type<u64, u64>(10u64));
    foo(x);
    ensures(x.contains_with_type<u64, u64>(10u64));
    ensures(x.borrow(10u64) == 0);
}
