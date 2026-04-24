# Reviewer 5 — Tests, Documentation, Adversarial Scenarios, Move 2024 Conformance

Scope: test coverage, docs, spec drift, Move 2024 idioms, adversarial paths.

## Tests

### R5-01 [HIGH] Zero Move unit tests, zero Move integration tests — entire repo
- `find sources -name "*_tests.move"` → empty. Confirmed by direct filesystem search.
- The new PAS integration includes:
  - Whitelist state machine with per-address `(can_send, can_receive)` tuples.
  - Mint-into-Account / Burn-via-clawback / Seize flows, each with a separate witness.
  - Permissionless `approve_transfer` autoresolve path gated by whitelist.
  - Integration with shared Namespace + Policy + Templates objects.
- None of these have automated coverage. Audit will cost 2-3x more because auditors will have to derive invariants by hand.
- Fix: minimum baseline:
  - `pas_admin::register_pas_asset` — happy path, duplicate-registration abort, non-zero `treasury_cap.total_supply` abort.
  - `treasury::add_to_whitelist` — happy path; `EAlreadyWhitelisted`; `ENotInWhitelist` on remove.
  - `treasury::set_whitelist_{send,receive}` — toggles; abort on unknown addr.
  - `pas_supply::mint` — whitelisted receiver → success; non-whitelisted → abort; zero amount → abort; paused → abort; duplicate call across PTB.
  - `pas_supply::burn` — happy path; paused → abort; zero amount → abort.
  - `pas_supply::seize` — happy path to whitelisted `to`; abort on non-whitelisted `to`; pause interaction (see HIGH on pause-flag).
  - `pas_transfer::approve_transfer` — happy path; sender not whitelisted; receiver not whitelisted; paused; zero amount; wrong version.
  - `supply::{mint,redeem}` — PAS coin abort with `EPasCoinNotAllowed`.
- Scaffolding tool: `/move-tests` (matches house skill).

## Adversarial scenarios considered

### R5-02 [MEDIUM — originally C claim, downgraded] "User can steal via `unlock_balance`" — REJECTED
- Analysis: `pas::account::unlock_balance` is permissionless. User calls it → `withdraw_balance` withdraws funds from their PAS account → returns `Request<UnlockFunds<Balance<T>>>`. The `Request` is a hot potato (no `drop`).
  - User attempts `unlock_funds::resolve_unrestricted_balance`: aborts via `ECannotResolveManagedAssets` at `pas/sources/requests/unlock_funds.move:45` because `namespace.policy_exists<Balance<T>>()` is true.
  - User attempts `unlock_funds::resolve(request, policy)`: aborts inside `policy.required_approvals(unlock_funds_action())` via `ENotSupportedAction` because Hadron never registered an approval set for that action.
  - In both cases the abort happens *before* the `Request` is consumed. Move transaction atomicity rolls back the entire transaction including the `withdraw_balance`. User's balance is preserved.
- **No loss of funds.** BUT — see R3-02 MEDIUM: the invariant is load-bearing on a *combination* of PAS upstream behaviours. Any change (e.g. PAS auto-approving missing actions) would break it.

### R5-03 [MEDIUM] "Front-run a mint with a deny-list add" — non-impactful in PAS, but worth a note for non-PAS
- The non-PAS path uses `DenyListV2`. The PAS path uses whitelist. For PAS: the whitelist is an allow-list, so "remove from whitelist immediately before a mint" is an order-of-ops issue that manifests as an abort on the mint rather than a silent mis-routing. Correct by design.

### R5-04 [MEDIUM] "Seize while paused" — regulatory officer cannot recover during incident
- Cluster with the HIGH pause-flag finding (R1-01). Re-stating here from the adversarial angle: during an incident, if a compliance officer pauses mint/redeem to stop a bleed, they simultaneously lose the ability to seize from the attacker. The adversary has time to move funds (within the whitelist), file a clawback request, and force the officer to choose between supply lockdown and recovery.

### R5-05 [MEDIUM] Whitelist race — "whitelist sender, send, un-whitelist" within one PTB is not prevented
- `sources/treasury.move:315, 325, 335, 349` + `pas_transfer::approve_transfer`.
- A compliance officer could add an address to the whitelist, the user sends, and the officer removes — all in one PTB. That's actually the intended design. The adversarial angle is different: **anyone with `WhitelistManagePermission` can temporarily whitelist themselves for the duration of one PTB**, making whitelist permission strictly more privileged than it looks. Audit should explicitly note that `WhitelistManagePermission` is "de facto send/receive permission" since the holder can self-whitelist atomically.
- Fix: separate `WhitelistAddPermission` from `WhitelistRemovePermission` to match the Notion spec; audit the permission hand-out in `full-setup.ts` (compliance_officer role holds it today — correct, but document the implication).

## Documentation / spec drift

### R5-06 [INFO] Notion spec says `WhitelistAddPermission` + `WhitelistRemovePermission`; code implements unified `WhitelistManagePermission`
- `sources/permissions.move:35`
- Intentional simplification per the commit message. Spec should be updated, OR the permission should be split (see R5-05 — splitting has security rationale, not just compliance).

### R5-07 [INFO] Hadron Blueprint doc says "Abilities"; code says "Permissions"
- Doc-only drift. Harmonize.

### R5-08 [INFO] `pas_transfer::approve_transfer` doc comment does not mention the version check
- `sources/pas_transfer.move:30-37` has `version.check_is_valid()` but the docstring doesn't mention version gating. Add a line.

## Move 2024 conformance

### R5-09 [LOW] `Move.toml` uses `edition = "2024.beta"`
- `Move.toml:4`. The `2024` edition is stable. `2024.beta` is older.
- Fix: bump to `edition = "2024"` and re-verify compile.

### R5-10 [LOW] `token_template_pas/Move.toml` correctly uses `edition = "2024"` but `[dependencies]` is empty
- Already flagged by R4-07.

### R5-11 [LOW] Minor: `#[error]` constants used throughout — consistent with Move 2024 recommendation. ✅

### R5-12 [LOW] `public struct WhitelistEntry has copy, drop, store` — `copy` unused (R2-05 duplicate)

### R5-13 [LOW] `public struct TransferApproval<phantom T>() has drop` — positional struct with phantom T — clean Move 2024 style ✅

### R5-14 [LOW] `public struct ClawbackApproval<phantom T>() has drop` — same ✅

### R5-15 [LOW] `register_transfer_template` visibility
- `sources/pas_admin.move:127-151` is `fun` (private) not `public(package)`. Good.

## Operational / runbook

### R5-16 [MEDIUM] No runbook for "what happens if PAS upstream blocks a version"
- If PAS upstream calls `versioning::block_version(v)` where `v` matches Hadron's policy version, every Hadron PAS operation that calls `policy.versioning().assert_is_valid_version()` will abort. Recovery path: `policy::sync_versioning` (permissionless). But there is no Hadron documentation telling operators what to do.
- Fix: add a runbook section in the README covering "PAS upstream version block: `sync_versioning` on each Policy, verify operations resume".

### R5-17 [MEDIUM] Package re-deploy would orphan autoresolve templates — no migration path
- `sources/pas_admin.move:127-151`. `ptb::move_call(approval_type.address_string(), ...)` uses the defining ID, stable across upgrades. A re-deploy (new package ID) would leave templates pointing at the old address. Hadron offers `update_transfer_template` but the PAS SDK autoresolve uses the type → template registry keyed by `TransferApproval<T>` type. After re-deploy the *type* is different (defining ID changes), so the old template key becomes unreachable anyway — but the old template remains in storage, orphaned.
- Fix: document that a re-deploy requires a `unset_template_command` call for each PAS-registered coin, followed by fresh `register_transfer_template` calls. Or add a `Templates` cleanup helper.

### R5-18 [LOW] No in-repo README section describing PAS integration; quickstart lives in `full-setup.ts` only
- Add a README section: "PAS asset flow: deploy → register_pas_asset → whitelist → mint → transfer → (optional) seize/burn". Link to SOLENG-653 and PAS architecture doc.
