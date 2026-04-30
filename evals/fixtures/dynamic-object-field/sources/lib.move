module example::lib;

use sui::dynamic_object_field;

public struct Parent has key, store {
    id: UID,
}

// TODO: define a `Child` struct with `key + store` abilities,
// then add `add_child` and `borrow_child` functions using
// `sui::dynamic_object_field::add` / `::borrow`.
