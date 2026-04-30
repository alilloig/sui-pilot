module nft::nft;

use sui::package::Publisher;
use sui::transfer_policy;
use sui::transfer_policy::TransferPolicy;
use sui::royalty_rule;

public struct MyNft has key, store {
    id: UID,
    name: vector<u8>,
}

// TODO: add `init_policy(publisher: &Publisher, ctx: &mut TxContext)` that
// creates a TransferPolicy<MyNft> via transfer_policy::new, attaches a 5%
// royalty rule via royalty_rule::add, and shares the policy.
