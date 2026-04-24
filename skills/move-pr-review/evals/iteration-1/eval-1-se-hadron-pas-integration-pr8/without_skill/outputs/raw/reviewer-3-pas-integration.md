# Reviewer 3 — PAS Integration Boundary (Upstream Dep Verification)

Scope: every call from `hadron::*` into `pas::*` and `ptb::*`, cross-checked against `/Users/alilloig/workspace/pas@b64f0c5`.

## Integration call-site verification

| Hadron call | Upstream signature | Verdict |
|---|---|---|
| `policy::new_for_currency(namespace, &mut treasury_cap, true)` | `pas/sources/policy.move:46-68` | ✅ signature matches; `clawback_allowed=true` ok |
| `policy.set_required_approval<_, TransferApproval<T>>(&cap, send_funds_action())` | `policy.move:80-90` | ✅ `A: drop` bound met by `TransferApproval<T>()` |
| `policy.set_required_approval<_, ClawbackApproval<T>>(&cap, clawback_funds_action())` | same | ✅ `ClawbackApproval<T>()` has `drop` |
| `policy.share()` | `policy.move:70-72` | ✅ |
| `templates::set_template_command(templates, permit, cmd)` | `templates.move:30-41` | ✅ Permit must come from witness-defining module — `pas_transfer::transfer_approval_permit<T>()` defines `TransferApproval<T>` and wraps `internal::permit` ok |
| `clawback_funds::resolve(request, policy)` | `clawback_funds.move:28-35` | ✅ asserts `is_clawback_allowed`; policy was created with `true` |
| `send_funds::resolve_balance(request, policy)` | `send_funds.move:62-71` | Called by SDK, not Hadron. Hadron's `approve_transfer` supplies witness; SDK finalizes. ✅ |
| `account.deposit_balance(balance)` | `account.move:140-143` | ✅ takes `&Account`; routes via `balance::send_funds` to derived account address |
| `unlock_funds::resolve_unrestricted_balance` | `unlock_funds.move:41-50` | ⚠️ not called by Hadron. If any user attempts it, aborts via `ECannotResolveManagedAssets` because `policy_exists<Balance<T>>` returns true |
| `unlock_funds::resolve` | `unlock_funds.move:54-60` | ⚠️ not called by Hadron. Aborts via `ENotSupportedAction` from `policy.required_approvals(unlock_funds_action())` because Hadron never registered approvals for that action |
| `request::resolve` | `request.move:45-52` | strict equality on approvals set; Hadron registers exactly one witness per action → compatible |
| `ptb::move_call(pkg_addr, module, function, args, type_args)` | `ptb.move:303-322` | ✅ used with `approval_type.address_string()` → defining-ID (stable across upgrades) |

## Findings

### R3-01 [HIGH] `Move.toml` pins `pas` and `ptb` to `rev = "main"` — non-reproducible builds, audit-vs-deploy drift
- `Move.toml:7-8`
- The entire security posture (unlock abort semantics, request strict-equality, policy lifecycle) rests on PAS upstream semantics. `rev = "main"` means `sui move build` pulls whatever HEAD is at build time. Audit + deploy could use different commits.
- `Move.lock:26-32` records a specific commit (`b64f0c5`) for testnet but that is regenerated on the next lock refresh.
- Fix: pin `rev = "<commit-hash>"` in `Move.toml`. Bump only after re-running audit against the new upstream HEAD. Document the pinning strategy. Consider vendoring PAS or mirroring to an org-controlled tag.

### R3-02 [MEDIUM] `unlock_funds` action intentionally undefined — relies on upstream abort behaviour; undocumented
- `sources/pas_admin.move:49-57`
- The "closed loop" invariant for Hadron PAS assets is that users cannot unilaterally unlock. Today this is achieved by *omitting* the `unlock_funds_action()` registration, which causes PAS upstream to abort via `ENotSupportedAction` (policy line 77) or `ECannotResolveManagedAssets` (unlock_funds line 45). Safe **today** because `Request` has no `drop`, so aborts roll back the `withdraw_balance`. No loss of funds.
- However:
  - The abort reason is from PAS, not Hadron — opaque UX.
  - A future PAS upstream change (e.g. auto-approving unlock when no requirement is registered) would silently break the invariant.
  - A maintainer reading `register_pas_asset` cannot tell unlock was intentionally denied.
- Fix: (a) add a docstring explaining the invariant; (b) optionally register a `NoUnlockApproval` witness that is never constructed outside the module, producing a Hadron-specific abort.

### R3-03 [MEDIUM] `type_name::with_defining_ids` chosen for template package address — stable across upgrades, but semantics differ from `with_original_ids` and should be documented
- `sources/pas_admin.move:127-151`
- `approval_type.address_string()` where `approval_type = type_name::with_defining_ids<TransferApproval<T>>()` resolves to the *defining* package ID (i.e. the first publish). This is exactly the "stable pointer" the SDK autoresolve needs. With `with_original_ids` it would resolve to the original publication of the type (equivalent here, since `TransferApproval<T>` is defined in this package). After a Hadron upgrade, the defining-ID route remains correct — template still points at the right `approve_transfer`. After a *re-deploy* (new package ID), old templates would still point at the old package.
- Fix: add a code comment documenting why `with_defining_ids` vs `with_original_ids` and the consequence for re-deploys.

### R3-04 [MEDIUM] `pas_transfer::approve_transfer` assumes PAS upstream's `send_funds::resolve_balance` delivers `Balance<T>` to `recipient_account_id.to_address()`
- `sources/pas_transfer.move:30-50` + `pas/sources/requests/send_funds.move:66-71`
- `approve_transfer` validates `recipient` (the *wallet* address). PAS then delivers to `recipient_account_id` (derived account address). PAS upstream `account::internal_send_balance` computes `recipient_account_id = namespace::account_address_from_id(from.namespace_id, to)` where `to` is the wallet address. Thus the account address is deterministically derived from the wallet address — whitelisting the wallet suffices. Upstream correctness.
- However: the invariant is load-bearing. If PAS ever changes `recipient_account_id` derivation, Hadron's whitelist (wallet-keyed) would silently diverge from what PAS delivers to.
- Fix: document the "wallet → account" derivation as a PAS upstream contract Hadron depends on; add an integration test that exercises the send-balance happy path end-to-end (see H testing finding).

### R3-05 [LOW] Hadron does not expose a `sync_versioning` entrypoint for the PAS policy
- PAS upstream `policy::sync_versioning` is permissionless. Not a Hadron bug — anyone can call it. Worth noting for the runbook.

### R3-06 [LOW] `pas_supply::burn` / `seize` have no way to assert the provided `policy` matches the treasury-stored `PolicyCap`
- `sources/pas_supply.move:55-72, 76-93`
- PAS namespace structurally guarantees uniqueness (`policy_exists<Balance<T>>` at creation). Two `Policy<Balance<T>>` objects cannot exist. Thus no forgery path. Defense-in-depth: compare `object::id(policy)` with a Treasury-side `policy_id<T>` getter (currently absent).

### R3-07 [INFO] Hadron does not register an approval for `send_funds_action` on the regulated-coin path
- Non-PAS coins use `supply::{mint,redeem}` and `Coin<T>::transfer`. They never flow through PAS. Correct by design; worth a documentation line.
