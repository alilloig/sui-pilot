module demo::demo;

use sui::coin;

// TODO: declare a one-time witness struct named DEMO with the drop ability,
// then take it by value as the first parameter of init.
fun init(ctx: &mut TxContext) {
    // TODO: call coin::create_currency<DEMO>(otw, 9, b"DEMO", b"Demo Coin",
    //       b"Demo currency", option::none(), ctx),
    //       freeze the CoinMetadata, and transfer the TreasuryCap to the sender.
    let _ = ctx;
}
