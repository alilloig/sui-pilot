module simple_package::example {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};

    /// A simple example object
    public struct Example has key, store {
        id: UID,
        value: u64,
    }

    /// Create a new Example object
    public fun create_example(value: u64, ctx: &mut TxContext): Example {
        Example {
            id: object::new(ctx),
            value,
        }
    }

    /// Get the value from an Example object
    public fun get_value(example: &Example): u64 {
        example.value
    }

    /// Update the value in an Example object
    public fun update_value(example: &mut Example, new_value: u64) {
        example.value = new_value;
    }

    /// Destroy an Example object
    public fun destroy_example(example: Example): u64 {
        let Example { id, value } = example;
        object::delete(id);
        value
    }
}