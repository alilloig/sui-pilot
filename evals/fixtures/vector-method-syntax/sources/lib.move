module example::lib;

public fun roundtrip(x: u64): u64 {
    let mut v = vector::empty<u64>();
    vector::push_back(&mut v, x);
    let popped = vector::pop_back(&mut v);
    vector::destroy_empty(v);
    popped
}
