module example::lib;

public struct Parent has key {
    id: UID,
}

public struct Child has key {
    id: UID,
    index: u64,
}

public fun new_parent(ctx: &mut TxContext): Parent {
    Parent { id: object::new(ctx) }
}

// TODO: add `derive_child(parent: &mut Parent, index: u64, ctx: &mut TxContext)`
// that uses `sui::derived_object` to mint a Child with a deterministic UID
// derived from the parent's UID and the index.
