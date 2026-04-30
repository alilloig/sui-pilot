module trade::trade;

// BUG: Receipt currently has too many abilities. The hot-potato pattern
// requires it to have NO abilities so it cannot be stored, copied, or dropped.
public struct Receipt has copy, drop, store {
    amount: u64,
}

public fun start_trade(amount: u64): Receipt {
    Receipt { amount }
}

// TODO: add `complete_trade(receipt: Receipt, ...)` that destroys the
// receipt by-value via destructuring.
