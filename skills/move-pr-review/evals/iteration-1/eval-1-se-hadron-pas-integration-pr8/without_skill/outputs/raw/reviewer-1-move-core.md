# Reviewer 1 — Move Core (Access Control, Types, Compliance)

Scope: `sources/pas_admin.move`, `sources/pas_supply.move`, `sources/pas_transfer.move`, `sources/supply.move`, `sources/permissions.move`.

## Findings

### R1-01 [HIGH] Pause flag `is_mint_redeem_paused` conflates three regulatory levers
- `sources/pas_supply.move:46, 62, 83`, `sources/pas_transfer.move:44`
- One key (`MintRedeemPausedKey<T>`) gates: non-PAS supply, PAS mint, PAS burn, PAS seize, and PAS transfer approval.
- Operationally, a compliance officer that pauses issuance during an incident simultaneously: (a) loses the ability to seize from a bad actor (`seize` aborts), and (b) halts the entire legitimate market (transfers blocked). There is no knob to "halt new supply but keep clawback alive" even though the PAS design explicitly separates clawback from send.
- Fix: split into `MintRedeemPausedKey<T>` and `TransferPausedKey<T>`, drop the pause assertion from `seize` entirely (regulatory recovery should never be pausable by the same key that pauses supply), add distinct `PauseTransferPermission`/`UnpauseTransferPermission`.

### R1-02 [MEDIUM] `pas_supply::{mint,burn,seize}` lack `is_pas_coin<T>` guard
- `sources/pas_supply.move:39-51, 55-72, 76-93`
- The symmetric guard exists in `supply::{mint,redeem}` (`sources/supply.move:35, 51`). Inverse check is missing on the PAS side. A caller with `MintPermission` for a non-PAS coin T could invoke `pas_supply::mint` — `treasury_cap_mut<T>` borrows successfully (T is registered), `account.deposit_balance` works (no type binding), and non-PAS balance lands in a PAS-shaped Account. Not a direct loss but (1) confuses indexers, (2) can be abused to route non-PAS funds through a PAS Account (accidental escape of closed-loop invariants), (3) bypasses events meant for PAS tokens.
- Fix: prepend `assert!(treasury.is_pas_coin<T>(), ENotPasCoin);` in all three functions.

### R1-03 [MEDIUM] `update_transfer_template` does not check coin is PAS
- `sources/pas_admin.move:113-121`
- Caller holding `RegisterCoinPermission` can register a template for a coin that has no PAS policy. Template would point at `pas_transfer::approve_transfer<T>` that will abort on first use. No fund loss; noise in the shared `Templates` object and confusing on-chain state.
- Fix: add `assert!(treasury.is_pas_coin<T>(), ENotPasCoin);` at the top.

### R1-04 [MEDIUM] `assert_can_send`/`assert_can_receive` abort on non-PAS coin with generic framework error
- `sources/treasury.move:287-312`
- `can_send` / `can_receive` / `is_whitelisted` all do `dynamic_object_field::borrow(whitelist_key<T>)` unconditionally. For a non-PAS coin, they abort via the DOF framework (`EFieldDoesNotExist`) rather than a Hadron error. On the read path this surfaces as an opaque abort; off-chain callers of `is_whitelisted` (public getter) get a system abort instead of a boolean.
- Fix: guard `is_whitelisted`/`can_send`/`can_receive` with `if (!is_pas_coin<T>(treasury)) return false;`. Keep `assert_can_send`/`assert_can_receive` aborts, but use `ENotPasCoin` first.

### R1-05 [MEDIUM] `add_to_whitelist` forces full privileges — partial-whitelist requires two TXs
- `sources/treasury.move:315-322`
- The only whitelist-add path is `add_to_whitelist` which sets `can_send: true, can_receive: true`. Any "receive-only" or "send-only" setup requires a second tx (`set_whitelist_send`/`set_whitelist_receive`). Between the two there is a live window where the address is fully authorized.
- Fix: add `add_to_whitelist<T>(treasury, addr, can_send: bool, can_receive: bool)` signature or overload.

### R1-06 [MEDIUM] `EMintRedeemPaused` in `pas_transfer` is misleadingly named
- `sources/pas_transfer.move:17-19, 44`
- User attempting a transfer sees "Mint and redeem operations are paused for this PAS asset". Semantically misleading and also violates the Move Book error-naming recommendation to reflect the failing operation.
- Fix: rename (e.g. `ETransferPaused`) and, downstream, once H-R1-01 is addressed, key off a distinct flag.

### R1-07 [LOW] `pas_supply::seize` takes `&Treasury`, so `assert_mint_redeem_enabled` compiles against an immutable reference — but is semantically wrong here
- `sources/pas_supply.move:76-82`
- The pause check on a regulatory recovery function is a policy-design antipattern. Confirms the broader R1-01 finding. If R1-01 is not addressed, at minimum drop the assertion here (seize should always proceed).

### R1-08 [LOW] `pas_supply::burn` / `seize` accept `policy: &Policy<Balance<T>>` without verifying it matches the registered one
- `sources/pas_supply.move:55-72, 76-93`
- An attacker-supplied `Policy<Balance<T>>` shared object matching the type would not be accepted by PAS (policies are derived per-namespace per-type so uniqueness is structural), but the hadron code does not verify that the passed `policy` matches the Treasury's stored `PolicyCap<Balance<T>>`. Defense-in-depth only; no exploit path identified.
- Fix: `assert!(object::id(policy) == policy_cap_derived_id, ...)` or compute from `type_name::with_defining_ids<Balance<T>>`.

### R1-09 [LOW] `pas_transfer::transfer_approval_permit` `public(package)` but only called from `pas_admin`
- `sources/pas_transfer.move:54-56`
- Could be made private with a `friend` or, cleaner, made truly private by moving the template registration into `pas_transfer` (since the permit is defined by the witness owner module, that is symmetrical).
- Fix: inline or tighten the visibility.

### R1-10 [INFO] `register_pas_asset` never registers an approval for `unlock_funds_action`
- `sources/pas_admin.move` + PAS `unlock_funds.move:45, 54`
- Deliberately missing registration means `unlock_funds::resolve` aborts via `ENotSupportedAction`. `resolve_unrestricted_balance` also aborts because `policy_exists<Balance<T>>` is true. Since `Request` has no `drop`, the abort rolls back the prior `withdraw_balance`. No loss of funds. **Document this as a load-bearing decision** — a future maintainer may "fix" the missing unlock registration and silently break the closed-loop invariant.

### R1-11 [INFO] `pas_supply::mint` does not validate `Account` is derived from PAS Namespace
- `sources/pas_supply.move:39-51`
- PAS's `Account::create` is keyed off the singleton `Namespace` via `derived_object`, so structural uniqueness prevents impersonation. Safe by construction. Worth a comment.
