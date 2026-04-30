module pool::pool;

public struct Pool has key {
    id: UID,
    balance: u64,
}

public entry fun create(ctx: &mut TxContext) {
    transfer::share_object(Pool { id: object::new(ctx), balance: 0 });
}

public entry fun deposit(p: &mut Pool, amount: u64) {
    p.balance = p.balance + amount;
}

public entry fun withdraw(p: &mut Pool, amount: u64) {
    p.balance = p.balance - amount;
}
