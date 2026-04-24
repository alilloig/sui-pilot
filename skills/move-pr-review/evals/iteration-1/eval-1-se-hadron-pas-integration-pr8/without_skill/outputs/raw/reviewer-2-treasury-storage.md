# Reviewer 2 — Treasury, Storage, Keys, Events

Scope: `sources/treasury.move`, `sources/keys.move`, `sources/events.move`, integration with `roles.move`.

## Findings

### R2-01 [HIGH] PolicyCap stored but never used after registration → policy is effectively frozen
- `sources/treasury.move:272-275` (accessor) and `sources/pas_admin.move:62-67`
- `PolicyCap<Balance<T>>` is stored as a DOF. Nothing in the PR (or elsewhere in the package) borrows it to call `policy::set_required_approval`, `policy::remove_action_approval`, or `policy::sync_versioning`. After `register_pas_asset` runs, the only way to mutate the Hadron PAS policy is a package upgrade.
- Particularly relevant for: adding a second approval witness; synchronising versioning if PAS upstream blocks an old version; changing approval requirements under incident response.
- Fix: add `pas_admin::update_policy_approval<T, W: drop>(treasury, auth, &mut policy, action, permit)` and `pas_admin::sync_policy_versioning<T>(treasury, &mut policy, namespace)` gated by `TreasuryAuth<RegisterCoinPermission>` or a new `ManagePolicyPermission`.

### R2-02 [MEDIUM] PAS events lack correlation metadata (`treasury_id`, `policy_id`, `coin_type` string)
- `sources/events.move:89-131`
- `PasAssetRegistered<T>`, `PasMinted<T>`, `PasBurned<T>`, `PasSeized<T>`, `PasTransferApproved<T>`, `WhitelistAdded<T>`, etc., carry only addresses and amounts. Multi-institution deployments (multiple Treasuries, each with its own PAS assets) cannot be reliably correlated off-chain without the `treasury_id`. Cross-system correlation with PAS's own events requires `policy_id`.
- Fix: add `treasury_id: ID` to every PAS event; consider `policy_id: ID` (derivable off-chain via PAS namespace + type, but expensive).

### R2-03 [MEDIUM] `PasAssetRegistered<T>` is empty (no payload) and `CoinRegistered<T>` is also empty
- `sources/events.move:15, 91`
- Empty-payload events force indexers to join event type with tx-level metadata (sender, timestamp, tx digest) to be useful. Add at minimum `treasury_id: ID`, the registrar's address, and (for PAS) the `policy_id`.

### R2-04 [MEDIUM] `register_transfer_template` and `update_transfer_template` emit no event
- `sources/pas_admin.move:111-151`
- Templates are mutable post-registration (via `update_transfer_template`) and are integral to autoresolve. Template changes currently lack an audit trail on-chain.
- Fix: `TemplateUpdated<T> { treasury_id, autoresolve_target }` event.

### R2-05 [LOW] `WhitelistEntry` has unused `copy` ability
- `sources/treasury.move:234-237`
- `WhitelistEntry` has `copy, drop, store`. It's never copied (only inserted/read). Move Book recommends minimal abilities.
- Fix: drop `copy`.

### R2-06 [LOW] `PolicyCapKey<phantom T>`, `WhitelistKey<phantom T>`, `MintRedeemPausedKey<phantom T>` declare `copy` unnecessarily
- `sources/keys.move:22, 25, 28`
- Phantom-typed key witnesses don't need `copy`. `drop + store` is sufficient.

### R2-07 [LOW] Whitelist `Table` entries cannot be enumerated on-chain cheaply
- `sources/treasury.move:259-262`
- `Table<address, WhitelistEntry>` is fine for point lookup but does not expose iteration. Any "list all whitelisted" operation requires indexer + event replay. This is a known Sui primitive limitation; worth documenting for the partner.

### R2-08 [LOW] Doc comment in `sources/treasury.move:27` says "Table<address, bool>" but the actual type is `Table<address, WhitelistEntry>`
- Stale comment that predates the send/receive split. Fix.

### R2-09 [LOW] `EMintRedeemPaused` defined in both `treasury.move:32` and `pas_transfer.move:18` with different messages
- `sources/treasury.move:32`, `sources/pas_transfer.move:18`
- Two `EMintRedeemPaused` constants with different byte strings. Confusing for error aggregation.
- Fix: either centralize on treasury or rename one.

### R2-10 [LOW] `keys::whitelist_key<T>` name collides with PAS upstream's key naming conventions (`pas::keys::policy_key`, etc.)
- Purely cosmetic; `keys::whitelist_key` and `keys::policy_cap_key` are in `hadron::keys` namespace so no actual collision. Worth explicitly prefixing (e.g. `hadron_whitelist_key`) if the partner expects to embed PAS and Hadron keys side-by-side in a multi-package contract.

### R2-11 [INFO] `Treasury.roles: Roles` is shared, non-generic, and all PAS state is reachable via the same shared object
- `sources/treasury.move:74-77`
- Every PAS transfer that calls `approve_transfer` takes `&Treasury`. Every PAS mint/burn/seize takes `&mut Treasury`. This is the mint/transfer serialization point for the institution. For high-throughput PAS deployments this single shared object becomes the contention bottleneck. Not a correctness issue — a throughput/UX observation for the partner.
