/// Test module for LSP integration tests
/// This module contains test targets for hover, completions, and goto-definition
module lsp_test_package::main {
    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;

    /// Test constant for LSP testing
    const TEST_CONST: u64 = 42;

    /// A test struct for LSP testing
    /// Contains a single value field
    public struct TestStruct has key, store {
        id: UID,
        value: u64,
    }

    /// Create a new TestStruct
    /// @param value: The initial value
    /// @param ctx: Transaction context
    public fun test_function(value: u64, ctx: &mut TxContext): TestStruct {
        let result = TestStruct {
            id: object::new(ctx),
            value: value + TEST_CONST,
        };
        result
    }

    /// Get the value from a TestStruct
    public fun get_value(obj: &TestStruct): u64 {
        obj.value
    }

    /// Update the value in a TestStruct
    public fun set_value(obj: &mut TestStruct, new_value: u64) {
        obj.value = new_value;
    }

    /// Destroy a TestStruct and return its value
    public fun destroy(obj: TestStruct): u64 {
        let TestStruct { id, value } = obj;
        object::delete(id);
        value
    }
}
