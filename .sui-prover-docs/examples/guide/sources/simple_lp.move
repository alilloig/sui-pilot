module amm::simple_lp;

use sui::balance::{Balance, Supply, zero};
use sui::event;

#[spec_only]
use prover::prover::{requires, ensures, clone};
#[spec_only]
use prover::ghost::{declare_global, global};

public struct LP<phantom T> has drop {}

public struct Pool<phantom T> has key, store {
    id: sui::object::UID,
    balance: Balance<T>,
    shares: Supply<LP<T>>,
}

const LARGE_WITHDRAW_AMOUNT: u64 = 10000;

public struct LargeWithdrawEvent has copy, drop {}

fun emit_large_withdraw_event() {
    event::emit(LargeWithdrawEvent {});
    requires(*global<LargeWithdrawEvent, bool>());
}

public fun withdraw<T>(pool: &mut Pool<T>, shares_in: Balance<LP<T>>): Balance<T> {
    if (shares_in.value() == 0) {
        shares_in.destroy_zero();
        return zero()
    };

    let balance = pool.balance.value();
    let shares = pool.shares.supply_value();
    let shares_in_value = shares_in.value();

    let balance_to_withdraw =
        (((shares_in.value() as u128) * (balance as u128)) / (shares as u128)) as u64;

    pool.shares.decrease_supply(shares_in);

    if (shares_in_value >= LARGE_WITHDRAW_AMOUNT) {
        emit_large_withdraw_event();
    };

    pool.balance.split(balance_to_withdraw)
}

// Verify that the price of the token is not decreased by withdrawing liquidity
#[spec(prove)]
fun withdraw_spec<T>(pool: &mut Pool<T>, shares_in: Balance<LP<T>>): Balance<T> {
    requires(shares_in.value() <= pool.shares.supply_value());

    declare_global<LargeWithdrawEvent, bool>();

    let old_pool = clone!(pool);
    let shares_in_value = shares_in.value();

    let result = withdraw(pool, shares_in);

    let old_balance = old_pool.balance.value().to_int();
    let new_balance = pool.balance.value().to_int();

    let old_shares = old_pool.shares.supply_value().to_int();
    let new_shares = pool.shares.supply_value().to_int();

    ensures(new_shares.mul(old_balance).lte(old_shares.mul(new_balance)));

    if (shares_in_value >= LARGE_WITHDRAW_AMOUNT) {
        ensures(*global<LargeWithdrawEvent, bool>());
    };

    result
}
