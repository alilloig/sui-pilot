module raffle::raffle;

use sui::random::Random;

public struct Raffle has key {
    id: UID,
    participants: vector<address>,
    winner: Option<address>,
}

public entry fun create(ctx: &mut TxContext) {
    transfer::share_object(Raffle {
        id: object::new(ctx),
        participants: vector::empty<address>(),
        winner: option::none(),
    });
}

public entry fun enter(raffle: &mut Raffle, who: address) {
    raffle.participants.push_back(who);
}

// TODO: implement `draw_winner(raffle: &mut Raffle, r: &Random, ctx: &mut TxContext)`
// using `sui::random::new_generator(r, ctx)` and
// `random_generator::generate_u64_in_range` to pick a random participant.
