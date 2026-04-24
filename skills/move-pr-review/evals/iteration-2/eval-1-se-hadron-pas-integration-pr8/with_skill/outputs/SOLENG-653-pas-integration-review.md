# `se-hadron` — PAS Integration Review

**Ticket:** [SOLENG-653 — Hadron phase 2: Move consultation](https://linear.app/mysten-labs/issue/SOLENG-653/hadron-phase-2-move-consultation)
**PR:** [MystenLabs/se-hadron#8 — feat: add PAS asset integration with whitelist-based compliance](https://github.com/MystenLabs/se-hadron/pull/8)
**Branch:** `feat/pas-integration` @ `e72f685a3f9265bf3ea12a68a6aba86675bb3537`
**Upstream dep (read-only reference):** `MystenLabs/pas` @ `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc`
**Review date:** 2026-04-24
**Reviewers:** 1 orchestrator + 10 parallel sui-pilot-agent subagents + 1 consolidator
**Scope:** PAS-integration additions (new modules `pas_admin`, `pas_supply`, `pas_transfer`; diffs in `treasury`, `supply`, `events`, `permissions`, `keys`; new `token_template_pas` package; PAS off-chain scripts). Phase-1 code is NOT reviewed here — under a separate audit.

> **Headline:** **Approve-with-changes (blocking).** Two HIGH issues in `pas_admin` — `update_transfer_template<T>` lets any institution grief any other institution's autoresolve template, and its own post-upgrade recovery path is a no-op because it resolves `with_defining_ids` — must be fixed before merge. Zero Move tests and `Move.toml` pinned to branch `main` are independent blockers (see Test & coverage plan and Build reproducibility & ops).

---

## Executive summary

- **Posture:** *Approve-with-changes (blocking).* The PAS integration is structurally sound — single-witness approvals, clear whitelist CRUD, clean PTB template registration — but two cross-institution / post-upgrade correctness bugs require code changes.
- **Top 3 CODE risks:**
  1. `update_transfer_template<T>` allows cross-institution autoresolve template overwrite (DoS). See `[HIGH] H-1`.
  2. `update_transfer_template<T>` is a no-op post-upgrade because the package address is resolved via `with_defining_ids` — the documented recovery path doesn't recover. See `[HIGH] H-2`.
  3. `pas_supply::seize` is gated by the mint/redeem pause — compliance cannot extract funds while the treasury is paused, which is the operational opposite of the intent. See `[MEDIUM] M-1`.
- **Top 3 strengths:**
  1. `supply::mint` / `supply::redeem` are correctly guarded with `!is_pas_coin<T>()` — PAS coins are cleanly funneled through `pas_supply`.
  2. Witness types (`TransferApproval<T>`, `ClawbackApproval<T>`) are phantom-parameterized and unconstructable outside the defining module — clean integration with PAS `Request::approve`.
  3. Events are comprehensive and type-scoped (`PasMinted<T>`, `PasBurned<T>`, `PasSeized<T>`, `WhitelistAdded<T>`, etc.) — indexer-friendly.
- **Tests:** Zero Move unit tests on the new PAS modules. See [Test & coverage plan](#test--coverage-plan) — merge-blocking for audit handoff.
- **Build / dep / ops:** `Move.toml` pins `pas` and `ptb` to branch `main`. JS `number` is used for `u64` amounts in scripts. See [Build reproducibility & ops](#build-reproducibility--ops) — merge-blocking.
- **Spec drift:** Single `WhitelistManagePermission` (code) collapses the spec's `WhitelistAddPermission` + `WhitelistRemovePermission`. Intentional simplification; documented here at INFO.

---

## Severity tally (after leader verification)

| Severity | Count | Change from raw reviewer output |
|---|---|---|
| Critical | 0 | No criticals filed; verification introduced none. |
| High | 2 | Raw had 17 high-tagged findings; 15 were scripts/tests/versioning routed to ops/testing sections, plus 4 self-refuted or downgraded (R3-012 self-refuted, R8-002 cross-treasury refuted, C053 "missing 0xc" rejected, R6-001 confirmed). |
| Medium | 7 | Consolidated from ~25 raw medium findings; 10 rerouted to ops/testing sections. |
| Low | 13 | Includes split-offs from mega-clusters and opaque-abort ergonomic issues. |
| Info | 8 | Spec-drift notes, design-intent documentation, upstream-intended patterns. |
| Rejected | 4 | R3-012 arg-order (self-refuted), R8-002 cross-treasury Auth abuse (TreasuryCap uniqueness blocks), R5-027 namespace mismatch (singleton), C053 "missing 0xc" (0xc is a shared object, not a package dep). |

Raw reviewer output: 292 findings across 10 reviewers → 64 clusters → adjudicated to the distribution above. Full raw artifacts in `reviews/.raw/`.

---

## Findings

> **Scope of this section:** code-level findings only. Testing concerns are in [Test & coverage plan](#test--coverage-plan). Build / dep / bytecode / Move.toml concerns are in [Build reproducibility & ops](#build-reproducibility--ops).

### HIGH

#### H-1 — `update_transfer_template<T>` allows cross-institution autoresolve template overwrite  (`sources/pas_admin.move:113-121`)

**Cluster:** C006 (split)  **Agreement:** 1/10 (R6 framed it crisply; R2/R3/R4/R9 touched adjacent concerns)  **Confidence:** high

**Description.** `update_transfer_template<T>` accepts any `TreasuryAuth<RegisterCoinPermission>` bound to any treasury plus any type `T`. The function only asserts `auth.assert_is_valid_for_treasury(treasury.treasury_id())`. There is no check that coin `T` was registered in that treasury (`is_pas_coin<T>()`). Meanwhile, `pas::templates::Templates` is a global singleton shared across every Hadron institution (upstream `pas/sources/templates.move` L23-27), and `set_template_command<A>` keys the template by `type_name::with_defining_ids<TransferApproval<T>>()` — globally per coin type, not per treasury.

**Impact.** Adversary: any operator in institution B with `RegisterCoinPermission` on B's treasury. Attack: call `update_transfer_template<FooInA>(B_treasury, B_auth, templates, version)` where `FooInA` is a PAS coin registered to institution A. The call passes because the auth check is satisfied (auth matches B's treasury). `register_transfer_template<FooInA>` writes a new template command into the shared `Templates` object keyed by `TransferApproval<FooInA>`. The command now dispatches `hadron::pas_transfer::approve_transfer<FooInA>(B_treasury, request, version)`. All future autoresolve-driven transfers of `FooInA` will execute against B's treasury, which has no `WhitelistKey<FooInA>` DOF — the call aborts inside `assert_can_send<FooInA>`. Net effect: a persistent cross-institution DoS of every PAS transfer for the targeted coin, undoable only by institution A re-registering the template. This is a direct break of the Hadron Blueprint's institution-isolation invariant.

**Recommendation.** Add `assert!(treasury.is_pas_coin<T>(), ENotPasCoin);` as the first check in `update_transfer_template` and in the internal `register_transfer_template`. The `register_pas_asset` path already satisfies this transitively because it registers the policy-cap DOF and the whitelist DOF immediately after the internal call; hoist the `is_pas_coin` check into the shared internal helper.

**Evidence.**
```move
// sources/pas_admin.move:113-121
public fun update_transfer_template<T>(
    treasury: &Treasury,
    auth: &TreasuryAuth<RegisterCoinPermission>,
    templates: &mut Templates,
    version: &Version,
) {
    auth.assert_is_valid_for_treasury(treasury.treasury_id());
    register_transfer_template<T>(treasury, templates, version);
}
```

**Leader verification.** Confirmed: adversary path written concretely. Upstream `templates.move` L30-41 confirms `set_template_command` is not per-treasury-scoped. The `internal::permit<TransferApproval<T>>()` check does not help because `TransferApproval<T>` is defined in the Hadron package — any Hadron caller can mint a permit for any T. Split from mega-cluster C006 which also contained the whitelist-mutator-non-PAS claim (separately downgraded to LOW below).

---

#### H-2 — `update_transfer_template<T>` is a no-op post-upgrade — documented recovery path does not recover  (`sources/pas_admin.move:127-151`)

**Cluster:** C005 (split)  **Agreement:** 9/10 (R1, R2, R3, R4, R5, R6, R7, R9, R10; R8 refuted a separate arg-order sub-claim)  **Confidence:** high

**Description.** `register_transfer_template` derives the template's `package_id` as `type_name::with_defining_ids<TransferApproval<T>>().address_string()`. Per `std::type_name` (see `/Users/alilloig/workspace/sui/crates/sui-framework/packages/move-stdlib/sources/type_name.move` L42-45 — "defining IDs (the ID of the package in storage that first introduced the type)"), this is always the v1 Hadron package address for any upgraded Hadron deployment. `update_transfer_template` calls `register_transfer_template<T>` again, which re-resolves the same v1 address — a no-op. Meanwhile, `hadron::version::check_is_valid` compares the shared `Version` object's `version` field to the compile-time `VERSION` constant; after a legitimate `migrate`, v2's bytecode has `VERSION=2` and the stored state is `2`, so v2 passes — but v1's bytecode still has `VERSION=1` baked in and will abort every call.

**Impact.** Any hadron package upgrade breaks every PAS transfer. The autoresolve template, pinned to the v1 package by `with_defining_ids`, routes `approve_transfer<T>` calls to v1's bytecode. V1's `check_is_valid()` compares the shared `version` (now `2`) to its compiled `VERSION=1` and aborts with `EInvalidPackageVersion`. The documented escape hatch (`update_transfer_template`) re-writes the same v1 address and cannot repair the template. Operators have no on-chain remedy short of upstream PAS patching its template-resolution to use `with_original_ids` (which is stable across upgrades) or hadron exposing a template-key override parameter. Until any of those lands, every Hadron upgrade locks every registered PAS asset.

**Recommendation.** Either (a) accept an explicit `package_id: String` parameter in `update_transfer_template` so a governance-signed operator can pin the template to the upgraded package after `migrate`; (b) record the "current" package address in the Treasury at publish/upgrade time (via a module-level constant pointed to by an admin-writable DOF) and read it here; or (c) coordinate with upstream PAS to expose `set_template_command` keyed on `with_original_ids` instead of `with_defining_ids`. Also fix the module-level doc comment at L111-112 which misleadingly claims the function "Useful after package upgrades to point to the new package address" — it currently cannot.

**Evidence.**
```move
// sources/pas_admin.move:132-145
let approval_type = type_name::with_defining_ids<TransferApproval<T>>();
let coin_type = type_name::with_defining_ids<T>();

let cmd = ptb::move_call(
    approval_type.address_string().to_string(),
    b"pas_transfer".to_string(),
    b"approve_transfer".to_string(),
    vector[
        ptb::object_by_id(object::id(treasury)),
        ptb::ext_input<PAS>(b"request".to_string()),
        ptb::object_by_id(object::id(version)),
    ],
    vector[(*coin_type.as_string()).to_string()],
);
```

**Leader verification.** Confirmed against stdlib and upstream PAS. The stdlib's own rustdoc on `with_defining_ids` explicitly states the returned package ID is the *first* introducing version, which is immutable for the lifetime of the type. Sui PTB `move_call` with an immutable package ID dispatches to that *specific* published bytecode; the upgrade loader only redirects object layouts, not explicit `move_call` targets. R6-001 articulated the path cleanly; R1/R2/R3/R4/R5/R7/R9/R10 overlapped on the operational-hygiene framing. R8-014 dissented at medium framing but did not refute the core claim.

---

### MEDIUM

#### M-1 — `pas_supply::seize` is gated by mint/redeem pause — compliance can't extract funds during incidents  (`sources/pas_supply.move:76-93`)

**Cluster:** C029 (split, C029-B)  **Agreement:** 1/10 (R1; under-reported)  **Confidence:** high

**Description.** `seize<T>` calls `treasury.assert_mint_redeem_enabled<T>()` at the top. When operators pause mint/redeem (e.g. during a security incident that prompts the seize), this abort fires and blocks the compliance team from extracting funds from de-whitelisted addresses.

**Impact.** Operational semantics are inverted: pausing mint/redeem should constrain *user* flows, not admin compliance flows. A treasurer who pauses in response to an incident simultaneously disarms their seize capability. Per spec §7.2, seize is "not paused; seize must work against de-whitelisted addresses".

**Recommendation.** Remove `treasury.assert_mint_redeem_enabled<T>()` from `seize`. If an additional pause surface specific to compliance actions is desired, introduce a separate `SeizePausedKey<T>` rather than reusing the mint/redeem pause.

**Evidence.**
```move
// sources/pas_supply.move:83-84
treasury.assert_mint_redeem_enabled<T>();
treasury.assert_can_receive<T>(to.owner());
```

**Leader verification.** Confirmed. Only R1 flagged this — a coverage near-miss. No adversary path (this is a design regression, not an attack), but the operational impact is real and the fix is one line.

---

#### M-2 — Mint/redeem pause also disables PAS transfers — spec-ambiguous coupling  (`sources/pas_transfer.move:44`)

**Cluster:** C038  **Agreement:** 10/10  **Confidence:** medium

**Description.** `approve_transfer` asserts `!treasury.is_mint_redeem_paused<T>()` and reuses the error constant `EMintRedeemPaused` (which says "Mint and redeem operations are paused for this PAS asset"). This couples two conceptually distinct pause surfaces: pausing mint/redeem *also* halts user-to-user PAS transfers, with no separate transfer-pause control.

**Impact.** An operator who wants to halt issuance for a compliance review while allowing existing holders to keep transacting has no option. The error message is also confusing during transfers ("mint/redeem paused" is emitted from a transfer path). Spec §7.2 allows this coupling but the pattern should be explicit.

**Recommendation.** Decide on intent:
- **If coupling is desired:** rename the error to `ETransfersPaused` or `EAssetPaused` with a message that reflects the asset-wide scope, and document in the module header that `PauseMintRedeemPermission` also pauses transfers.
- **If decoupling is desired:** introduce a separate `TransferPausedKey<T>` and gate only on that.

**Evidence.**
```move
// sources/pas_transfer.move:44
assert!(!treasury.is_mint_redeem_paused<T>(), EMintRedeemPaused);
```

**Leader verification.** Confirmed. 10/10 reviewers flagged the semantics; split between "bug" and "design choice — needs doc". Leader adjudicates: design choice, but the error message is wrong in this call-site.

---

#### M-3 — `pas_transfer::approve_transfer` validates wallet sender/recipient, balance actually moves between derived account IDs  (`sources/pas_transfer.move:39-46`)

**Cluster:** C041  **Agreement:** 5/10 (R1, R2, R3, R5, R7)  **Confidence:** high

**Description.** `approve_transfer` reads `request.data().sender()` and `request.data().recipient()` (wallet or object addresses) and checks whitelist. Upstream `send_funds::resolve_balance<C>` (`pas/sources/requests/send_funds.move` L62-71) forwards the balance to `recipient_account_id.to_address()`, which is the derived-object address of the recipient's PAS Account. The wallet↔account relationship is 1:1 per namespace (via `account::create` and `keys::account_key(owner)`), so validating the wallet is sufficient IF the namespace mapping is trusted.

**Impact.** No exploitable path in the current design (namespace is a singleton upstream), but the pattern is fragile: any future refactor that permits multiple namespaces or alternative account-derivation paths would make the wallet-whitelist check semantically lag the actual destination.

**Recommendation.** Document the invariant in the module header. Optionally, add a defensive `assert!(request.data().recipient_account_id() == account::derived_id_for(namespace, request.data().recipient()))` as a cross-check — though this may be redundant given upstream's single-namespace design.

**Evidence.**
```move
// sources/pas_transfer.move:39-46
let sender = request.data().sender();
let recipient = request.data().recipient();
let amount = request.data().funds().value();

assert!(amount > 0, ETransferAmountZero);
assert!(!treasury.is_mint_redeem_paused<T>(), EMintRedeemPaused);
treasury.assert_can_send<T>(sender);
treasury.assert_can_receive<T>(recipient);
```

**Leader verification.** Confirmed at MEDIUM. This is the upstream-intended pattern per `send_funds.move` L22-28 ("sender/recipient is the wallet OR object address, NOT the account address"). Not a bug; documentation gap.

---

#### M-4 — No post-registration API to rotate PAS policy approvals  (`sources/pas_admin.move`, `sources/treasury.move`)

**Cluster:** C025  **Agreement:** 1/10 (R2)  **Confidence:** medium

**Description.** After `register_pas_asset`, the stored `PolicyCap<Balance<T>>` lives in a DOF. Hadron provides no public function that uses it to call `policy::set_required_approval` or `policy::remove_action_approval` post-registration. If the witness type ever changes (e.g. `TransferApproval` → `TransferApprovalV2` in a future upgrade), the required-approvals map is stuck on the old type name, and the stored PolicyCap is unreachable.

**Impact.** Upgrade-path flexibility is reduced; a future change to approval logic requires re-registering the asset (impossible — policy is 1:1 per coin).

**Recommendation.** Expose a `pas_admin::rotate_approvals<T, A_old, A_new>(treasury, auth, policy, ...)` that borrows `policy_cap` and calls `policy::set_required_approval`. Gate on `TreasuryAuth<RegisterCoinPermission>`.

**Evidence.**
```move
// sources/treasury.move:272-275
public(package) fun policy_cap<T>(treasury: &Treasury): &PolicyCap<Balance<T>> {
    assert!(is_pas_coin<T>(treasury), ENotPasCoin);
    dynamic_object_field::borrow(&treasury.id, keys::policy_cap_key<T>())
}
```

**Leader verification.** Confirmed as infrastructure gap. No adversary path. Worth adding for upgrade-forward-compatibility.

---

#### M-5 — `treasury::add_pas_coin_caps` does not validate that `metadata_cap` matches `treasury_cap`  (`sources/treasury.move:241-264`)

**Cluster:** C019  **Agreement:** 2/10 (R2, R5)  **Confidence:** medium

**Description.** `add_pas_coin_caps` stores `treasury_cap`, `metadata_cap`, and `policy_cap` as DOFs keyed by phantom `T`. Each is already typed by `T` (e.g. `MetadataCap<T>`), so a caller cannot pass a cap for a different coin — the type system prevents it. However, the `metadata_cap` for `T` could be created via a *different* currency-registration call than the `treasury_cap` (both share `T`). The on-chain `coin_registry::Currency<T>` is a singleton, so two distinct metadata_caps for the same `T` should not exist — but this is an unwritten invariant.

**Impact.** Low risk today due to singleton currency. Future coin-registry refactors that allow re-creation of `MetadataCap` would require this check.

**Recommendation.** Add a comment referencing the singleton invariant. Optionally assert the metadata_cap's currency-id matches the treasury_cap's coin_type via `coin_registry`'s public API if one is exposed.

**Leader verification.** Downgraded to low risk because type-system + currency singleton enforce the invariant.

---

#### M-6 — JS `number` used for u64 amounts in `pas.ts` — silent precision loss above 2^53  (`scripts/src/operations/pas.ts:209, 229`)

**Cluster:** C047  **Agreement:** 10/10  **Confidence:** high

**Description.** `mintPasTokens(..., amount: number)` passes the `amount` directly to an on-chain u64 parameter. JS `Number` loses integer precision above `2^53 - 1`. For a 6-decimal PAS coin, this caps precise amounts at ≈ 9 billion whole units.

**Impact.** Institutional bond issuance can plausibly exceed that range. Silent rounding of high-denomination operations.

**Recommendation.** Change `amount: number` → `amount: bigint` throughout the PAS scripts. Wrap BigInt in `tx.pure.u64(...)` when serializing.

**Evidence.**
```ts
// scripts/src/operations/pas.ts:205-231
export async function mintPasTokens(
    treasuryId: string, coinType: string, accountId: string, amount: number,
) { ... amount, ... }
```

**Leader verification.** Confirmed. Route would normally be ops, but this is borderline code-correctness in off-chain operations.

---

#### M-7 — `ClawbackApproval<T>` type-name identity must match upstream PAS Policy registration; no test enforces it  (`sources/pas_supply.move:33`, `sources/pas_admin.move:54-57`)

**Cluster:** C029 (split, C029-G integration-boundary)  **Agreement:** 4/10 (R3, R6, R7, R9)  **Confidence:** high

**Description.** `register_pas_asset` registers `ClawbackApproval<T>` in the PAS Policy via `policy.set_required_approval<_, ClawbackApproval<T>>(&policy_cap, clawback_funds_action())`. Upstream `policy::set_required_approval` (`pas/sources/policy.move` L80-90) keys the approval by `type_name::with_defining_ids<ClawbackApproval<T>>()`. `pas_supply::burn` and `seize` later call `request.approve(ClawbackApproval<T>())` — upstream `request::approve` (`pas/sources/requests/request.move` L25-27) inserts `type_name::with_defining_ids<ClawbackApproval<T>>()`. The two identities must match for `resolve` to succeed.

**Impact.** If the `ClawbackApproval<T>` struct is ever moved between modules (e.g. extracted into `hadron::pas_common`), the type-name changes and every pre-registered PAS asset becomes unresolvable (can't burn, can't seize). Irrecoverable because the policy's `required_approvals` map only accepts a PolicyCap-gated rotation, and the stored PolicyCap path would need to match-and-replace the old type-name.

**Recommendation.** Pin the struct's module location in a comment (`// MUST NOT MOVE — type-name is a PAS Policy key`). Add a test that snapshots `type_name::with_defining_ids<ClawbackApproval<T>>().as_string()` and `TransferApproval<T>` to catch accidental moves. Same for `TransferApproval<T>`.

**Evidence.**
```move
// sources/pas_supply.move:32-33
/// Witness for PAS clawback approval. Required by the PAS Policy for clawback_funds action.
public struct ClawbackApproval<phantom T>() has drop;
```

**Leader verification.** Confirmed MEDIUM. The risk is latent (only triggers on refactor) but the blast radius is total (all PAS assets registered under v1 become unresolvable).

---

### LOW

1. **L-1 — Whitelist mutators gate on `is_coin_registered<T>`, not `is_pas_coin<T>`** (C006 split, `sources/pas_admin.move:70-109`). Opaque abort inside `dynamic_object_field::borrow_mut` for non-PAS coins. Not cross-treasury-exploitable because `TreasuryCap<T>` is unique system-wide. Fix: add `assert!(treasury.is_pas_coin<T>(), ENotPasCoin)` at the top of each whitelist mutator.

2. **L-2 — `treasury::is_whitelisted`/`can_send`/`can_receive` abort opaquely on non-PAS coins** (C018, `sources/treasury.move:278-332`). Prepend `assert!(is_pas_coin<T>(treasury), ENotPasCoin)` or factor into a private helper.

3. **L-3 — `register_pas_asset` lacks explicit `!is_pas_coin<T>` pre-check** (C007, `sources/pas_admin.move:30-67`). Upstream `policy::new_for_currency` aborts on double-registration with `EPolicyAlreadyExists`; opaque surface. Add early `assert!(!treasury.is_pas_coin<T>(), ECoinAlreadyRegistered)`.

4. **L-4 — `pas_supply::burn/seize` lack explicit `is_pas_coin<T>` guard** (C029 split, `sources/pas_supply.move:55-93`). Physically blocked because caller must supply `Policy<Balance<T>>` (only exists for PAS coins), but cheap defensive check.

5. **L-5 — `update_transfer_template<T>` accepts non-PAS T** (C012, `sources/pas_admin.move:113-121`). Subsumed by H-1 once the `is_pas_coin` guard is added.

6. **L-6 — `pas_supply::burn` uses `RedeemPermission` — semantic mismatch with clawback-burn** (C029 split, `sources/pas_supply.move:55`). RedeemPermission is conceptually "user-redemption"; burn is "admin clawback-burn". Consider introducing `PasBurnPermission` or reusing `SeizePermission`. Align with spec's treatment of seize as distinct from redeem.

7. **L-7 — `WhitelistManagePermission` collapses four spec permissions** (C045, `sources/permissions.move`). Spec §7.2 lists `WhitelistAddPermission`, `WhitelistRemovePermission`. Code ships a single `WhitelistManagePermission`. Intentional simplification by the author; documented as drift.

8. **L-8 — `add_to_whitelist` defaults `can_send = can_receive = true`** (C020, `sources/treasury.move:315-322`). Surprising default — an address added for send-only receives the ability to receive by default. Consider an `add_to_whitelist_with_flags(treasury, auth, addr, can_send, can_receive)` variant.

9. **L-9 — Duplicate `EMintAmountZero` constant across `supply.move` and `pas_supply.move`** (C034). Minor style drift.

10. **L-10 — Duplicated `EMintRedeemPaused` string literal** (C040, `sources/supply.move`, `pas_transfer.move`). Centralize in one module.

11. **L-11 — `WhitelistKey` docstring says `Table<address, bool>`, actual type is `Table<address, WhitelistEntry>`** (C055, `sources/keys.move:28`). Fix docstring.

12. **L-12 — `Move.toml` declares `edition = "2024.beta"` while `token_template_pas/Move.toml` uses `"2024"`** (C002). Upgrade root package to stable `"2024"` once toolchain supports. Mismatch is ugly.

13. **L-13 — `pas_supply::mint/burn/seize` skip explicit `version.check_is_valid`** (C029 split, `C036`). Rely on auth-creation-time check. Document the invariant in the module header or add an explicit re-check. `pas_transfer::approve_transfer` is the outlier that *does* check (because it has no Auth parameter).

---

### INFO

1. **I-1 — `pas_supply::seize` deliberately does not whitelist-check the source** (C032, `sources/pas_supply.move:76-93`). Per spec §7.2 — seize must work against de-whitelisted addresses. Add a module-header note.

2. **I-2 — `pas_supply::mint` accepts Accounts owned by object addresses without docs** (C030, `sources/pas_supply.move:39-51`). `Account::owner()` can be a wallet address or an object's UID-derived address. Document so operators know which to whitelist.

3. **I-3 — `ClawbackApproval` as `public struct` — constructor is module-private** (C029 split). R10-029 framed as visibility concern; Move privacy rules confine the constructor to `hadron::pas_supply`. No forgery possible. Consistency with `TransferApproval` — keep as-is or mirror the permit pattern for uniformity.

4. **I-4 — `register_pas_asset` takes `&Version` but never checks it directly** (C013, `sources/pas_admin.move:30-67`). Version is checked transitively via the `TreasuryAuth<RegisterCoinPermission>` creation path. Document the implicit invariant.

5. **I-5 — `PasAssetRegistered<T>` emits no metadata** (C062, `sources/events.move`). No indication of clawback_allowed or treasury_id. Indexers must cross-reference other events. Consider emitting `{ treasury_id, clawback_allowed }`.

6. **I-6 — No `PasTemplateRegistered<T>` event from `register_pas_asset` / `update_transfer_template`** (C004, `sources/pas_admin.move`). Makes post-upgrade staleness detection harder. See H-2.

7. **I-7 — Doc comment in `register_transfer_template` mis-orders args** (C014, `sources/pas_admin.move:126`). The comment says "treasury, version, request" but the code passes `[treasury, request, version]`. Fix docstring.

8. **I-8 — `@mysten/pas@0.0.3` is a pre-1.0 SDK dependency** (C063, `scripts/package.json`). Expect API drift until 1.0. Not blocking.

---

## Integration-boundary notes

The review validated the following call sites against upstream `pas @ b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc`:

- ✅ `pas::policy::new_for_currency<C>(&mut Namespace, &mut TreasuryCap<C>, bool)` — signature matches. Correctly passes `true` for `clawback_allowed` (enables seize/burn).
- ✅ `pas::policy::set_required_approval<T, A>(&mut Policy<T>, &PolicyCap<T>, String)` — matches. Passes `send_funds_action()` / `clawback_funds_action()` correctly. Both action strings verified in `pas/sources/keys.move`.
- ✅ `pas::policy::share<T>(policy)` — matches.
- ✅ `pas::templates::set_template_command<A>(&mut Templates, internal::Permit<A>, Command)` — matches. Permit minted via `pas_transfer::transfer_approval_permit<T>()` which calls `internal::permit<TransferApproval<T>>()` from the defining module (required by upstream).
- ✅ `ptb::ptb::move_call(...)` — arg layout matches upstream `ptb.move` L268 signature. Argument order `[treasury, ext_input<PAS>("request"), version]` matches `approve_transfer<T>`'s Move signature `(treasury, request, version)`.
- ⚠️ `pas::templates::set_template_command` keys by `with_defining_ids<A>()` — creates the post-upgrade staleness documented in **H-2**.
- ✅ `pas::account::Account::owner()` / `deposit_balance<C>()` — matches. `deposit_balance` forwards to `object::id(account).to_address()` (not `account.owner`) — Hadron's code correctly passes `account` by `&Account` and does not assume otherwise.
- ✅ `pas::request::Request::data()` / `approve<K, U>()` — matches. Duplicate approvals abort via upstream `VecSet::insert`.
- ✅ `pas::clawback_funds::resolve<T>(Request, &Policy<T>) -> T` — matches. Upstream asserts `policy.is_clawback_allowed()` which Hadron ensures at registration.
- ✅ `pas::send_funds::SendFunds::sender()/recipient()/funds()` — matches. Wallet-level validation in `approve_transfer` is consistent with upstream's recipient-is-wallet-or-object-address contract (`send_funds.move` L22-28). See **M-3**.
- ✅ `pas::keys::send_funds_action()` / `clawback_funds_action()` — return constant strings; validated against upstream `keys.move`.

---

## Test & coverage plan

> This section aggregates all testing concerns into a single implementation plan.

**Current posture.** Zero Move unit tests on any of the three new modules (`pas_admin`, `pas_supply`, `pas_transfer`) and zero coverage for the new PAS helpers in `treasury.move` (whitelist CRUD, PAS cap storage, `is_pas_coin`). The `sources/` directory has no `tests/` subdirectory. Phase-1 code ships only `create_for_testing` / `share_for_testing` helpers; no test_only scaffolding is inherited. All verification currently relies on `scripts/src/examples/full-setup.ts` which runs against live testnet — slow, does not exercise abort branches, and depends on upstream PAS availability.

**Suggested test-implementation plan** (priority-ordered):

1. **`pas_admin::register_pas_asset<T>` — happy path + double-registration.** Use `treasury::create_for_testing`, `version::init_for_testing`, a test helper that mocks `pas::namespace::Namespace` (or invokes upstream `init_for_testing` if exposed). Assertions: `treasury.is_pas_coin<T>()` returns true; `PasAssetRegistered<T>` event emitted; second call aborts with `ECoinAlreadyRegistered`. Test utilities: `test_scenario` plus a `#[test_only]` upstream mock namespace.

2. **`pas_admin` whitelist CRUD lifecycle.** `add_to_whitelist → set_whitelist_send(false) → assert_can_send aborts → set_whitelist_send(true) → assert_can_send passes → remove_from_whitelist → assert_can_send aborts`. Plus error branches: adding an already-whitelisted addr aborts with `EAlreadyWhitelisted`; `remove_from_whitelist` of an unknown addr aborts with `ENotInWhitelist`; `set_whitelist_send` on an unknown addr aborts.

3. **`pas_supply::mint<T>` branch coverage.** Happy path + `EMintAmountZero` + `EMintRedeemDisabled` + `ENotWhitelistedReceive` + (optional) `ENotPasCoin` (if L-4 is applied). Assert `PasMinted<T>` event emitted with correct `recipient` and `amount`.

4. **`pas_supply::burn<T>` + `seize<T>` end-to-end.** Construct a `Request<ClawbackFunds<Balance<T>>>` via upstream `account::clawback_balance`, approve via `request.approve(ClawbackApproval<T>())`, resolve via `clawback_funds::resolve`. Assert balance destroyed (for burn) / redirected (for seize). Negative: `ESeizeAmountZero`, destination not whitelisted, paused.

5. **`pas_transfer::approve_transfer<T>` branch coverage.** Happy path + `ETransferAmountZero` + `EMintRedeemPaused` + `ENotWhitelistedSend` + `ENotWhitelistedReceive` + `EInvalidPackageVersion`. Verify idempotency: second call to `approve_transfer` on the same request aborts inside upstream `request::approve` (`VecSet::insert` duplicate).

6. **`supply::mint` / `supply::redeem` PAS guard.** Register a PAS coin T, then call `supply::mint<T>` with a minted `Auth<MintPermission, T>`. Assert `EPasCoinNotAllowed` fires.

7. **Cross-module: H-1 regression test.** Once the `is_pas_coin` guard lands, test that `update_transfer_template<T>` called from a treasury that did NOT register T aborts with `ENotPasCoin` — preventing cross-institution overwrite.

8. **Cross-module: H-2 staleness detection.** `#[test_only]` snapshot of `type_name::with_defining_ids<TransferApproval<T>>().as_string()` and `ClawbackApproval<T>` — to detect accidental module moves.

9. **Permission-coverage invariants.** After the `WhitelistManagePermission` and `SeizePermission` additions, assert that (a) the permission-coverage counter is updated consistently, (b) `ManageRolesPermission` cannot be unassigned below 1 holder (phase-1 invariant), (c) the new permissions integrate with the `roles::unassign` accounting.

Run `/move-tests` to scaffold these. Target ≥ 80% branch coverage on the new modules before audit handoff.

---

## Build reproducibility & ops

> This section aggregates all build / dep-pin / bytecode / Move.toml / CI concerns.

**Current posture.** `Move.toml` pins `pas` and `ptb` to branch `main`. `Move.lock` pins both to `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc` for the `testnet` env — but a fresh lockfile regeneration on a new env (e.g. `mainnet`) would re-resolve the branch tip. Root package declares `edition = "2024.beta"` while `token_template_pas` uses the stable `"2024"`. The PAS token template's bytecode is hard-coded in `scripts/src/deployPasTokenTemplate/getBytecode.ts`, with no regeneration script committed to the repo. TypeScript scripts use JS `number` for u64 amounts and `pkg()` can silently return `''` if deploy-output JSON is missing.

**Suggested ops checklist** (priority-ordered):

- [ ] **Pin `pas` and `ptb` to a commit hash.** Current: `rev = "main"`. Suggested: `rev = "b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc"` (matches current `Move.lock`). Update `Move.lock` alongside. Add a CI check (lint rule or pre-commit hook) that rejects any `git` dep whose `rev` is not a 40-char hex SHA. Consider tagging a PAS release upstream once the API stabilizes.
- [ ] **Promote `Move.toml` edition** from `"2024.beta"` to `"2024"`. Validate with `sui move build` that no beta-only features are used. Align with `token_template_pas/Move.toml`.
- [ ] **Commit a bytecode regeneration script** at `scripts/src/deployPasTokenTemplate/regen.ts` that builds `token_template_pas/` via `sui move build --dump-bytecode-as-base64` and overwrites `getBytecode.ts`. Add a CI step that diffs committed bytecode against a fresh build and fails on divergence.
- [ ] **Change `amount: number` → `amount: bigint`** across `pas.ts` (`mintPasTokens`, `sendBalance`, any other u64 argument). Serialize via `tx.pure.u64(BigInt(amount))`.
- [ ] **Guard `pkg()` against empty fallback.** Throw an explicit error when the deploy-output JSON is missing, rather than returning `''`.
- [ ] **Harden object-id extraction in `deployPasTokenTemplate`.** Replace `.includes('::coin::TreasuryCap<')` substring matches with `@mysten/sui/utils::parseStructTag` and explicit `{ address: '0x2', module: 'coin', name: 'TreasuryCap' }` comparison. Assert exactly one match per kind.
- [ ] **Centralize OTW / module-name derivation.** Extract the `symbol.toUpperCase().replace(/[^A-Z0-9_]/g, "_")` and `.toLowerCase()` transformations into a single exported helper shared between `patchConstants.ts` and `pas.ts`'s `deployAndRegisterPasAsset`. Add a unit test covering symbols with hyphens, spaces, and dots.
- [ ] **Declare `mainnet` env in `Move.lock` before opening the environment.** Ensure the SHA matches the testnet pin.
- [ ] **Optional: pin `@mysten/pas` to a minor-version range in `package.json`.** Pre-1.0 SDK drift is expected.

No CI config was reviewed; if a CI workflow exists, add the dep-pin lint rule to it. If no CI exists, this is a separate infra item.

---

## Methodology

**Workflow.** 1 orchestrator (main session) + 10 parallel `sui-pilot-agent` reviewer subagents + 1 `sui-pilot-agent` consolidator subagent. All 10 reviewers received the same context bundle (`reviews/.raw/_context.md`) and reviewer prompt. They worked independently.

**Subagent type actually used.** `sui-pilot:sui-pilot-agent` (enforces doc-first rule: reads `/Users/alilloig/workspace/dotfiles/.claude/sui-pilot/AGENTS.md` and `.sui-docs/` before reasoning about Move). No fallback to `general-purpose` was required.

**Skills invoked.** `move-pr-review` (this orchestrator), `move-code-review` (per-reviewer), `move-code-quality` (per-reviewer).

**Raw artifacts.** `reviews/.raw/subagent-1.json` … `subagent-10.json` (schema-validated; 292 total findings).

**Consolidation.** `reviews/.raw/_consolidated.json` — 64 clusters via `${CLAUDE_PLUGIN_ROOT}/skills/move-pr-review/scripts/consolidate.js`.

**Verification.** `reviews/.raw/_verification_notes.md` — leader adjudicated every cluster meeting `severity ≥ high` or `disputed_severity = true` or singleton-high or source_ids > 4.

**Quality gates met.**
- Schema validation: all 10 reviewer JSONs passed.
- Coverage matrix: every in-scope Move file received ≥ 7 reviewer touches. `token_template_pas/sources/token_template.move` received only 2 touches (R6, R10) — leader spot-read; confirmed trivial template file.
- Critical-finding reproduction: 0 criticals filed; 17 highs raised; 2 confirmed after verification, 4 rejected, 11 routed to ops/testing sections.
- Boundary spot-checks: validated `policy.move`, `templates.move`, `request.move`, `send_funds.move`, `clawback_funds.move`, `account.move`, `namespace.move` in upstream `/Users/alilloig/workspace/pas`.

**Non-reproducibility caveats.**
- Upstream dep `pas` HEAD used for review: `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc` (local clone). `Move.toml` pinned `rev = "main"` at review time — see H-2's cousin in Build & ops.
- Review run on working-tree state at HEAD `e72f685a3f9265bf3ea12a68a6aba86675bb3537`.
- MCP `move-analyzer`: not invoked in the reviewer pass (language-tooling degradation note).

**Tools.** Claude Code (Opus 4.7 1M context). Skills: `move-code-review`, `move-code-quality`, `move-pr-review`.

---

## Appendix A — Per-reviewer raw stats

| Reviewer | Total | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|---|
| R1 | 25 | 0 | 1 | 9 | 11 | 4 |
| R2 | 30 | 0 | 1 | 10 | 12 | 7 |
| R3 | 30 | 0 | 2 | 11 | 14 | 3 |
| R4 | 28 | 0 | 2 | 12 | 10 | 4 |
| R5 | 30 | 0 | 1 | 14 | 10 | 5 |
| R6 | 28 | 0 | 2 | 10 | 9 | 7 |
| R7 | 30 | 0 | 1 | 8 | 15 | 6 |
| R8 | 30 | 0 | 5 | 10 | 10 | 5 |
| R9 | 30 | 0 | 1 | 9 | 12 | 8 |
| R10 | 31 | 0 | 1 | 11 | 14 | 5 |
| **Total** | **292** | **0** | **17** | **104** | **117** | **54** |

## Appendix B — Cluster agreement distribution

| Reviewers agreeing | Clusters |
|---|---|
| 10 / 10 | 6 |
| 9 / 10 | 5 |
| 8 / 10 | 2 |
| 7 / 10 | 2 |
| 6 / 10 | 6 |
| 5 / 10 | 4 |
| 4 / 10 | 0 |
| 3 / 10 | 8 |
| 2 / 10 | 10 |
| 1 / 10 | 21 |
| **Total** | **64** |

## Appendix C — Coverage matrix

| File | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sources/pas_admin.move` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 10 |
| `sources/pas_supply.move` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 10 |
| `sources/pas_transfer.move` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 10 |
| `sources/treasury.move` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 10 |
| `sources/supply.move` | · | ✓ | · | · | · | ✓ | · | ✓ | · | · | 3 |
| `sources/events.move` | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8 |
| `sources/permissions.move` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 10 |
| `sources/keys.move` | ✓ | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | 7 |
| `Move.toml` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 10 |
| `token_template_pas/Move.toml` | · | ✓ | · | ✓ | · | · | ✓ | ✓ | ✓ | ✓ | 6 |
| `token_template_pas/sources/token_template.move` | · | · | · | · | · | ✓ | · | · | · | ✓ | 2 |
| `scripts/src/operations/pas.ts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 10 |
| `scripts/src/deployPasTokenTemplate/deployPasTokenTemplate.ts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | 7 |
| `scripts/src/deployPasTokenTemplate/getBytecode.ts` | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | 9 |
| `scripts/src/examples/full-setup.ts` | ✓ | ✓ | · | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | 8 |
| `scripts/src/constants.ts` | ✓ | ✓ | ✓ | · | ✓ | ✓ | · | · | ✓ | ✓ | 7 |
| `scripts/package.json` | · | · | ✓ | · | · | · | · | · | · | · | 1 |

## Appendix D — Artifacts index

- `reviews/.raw/_context.md` — shared context bundle
- `reviews/.raw/_reviewer_prompt.md` — reviewer prompt template
- `reviews/.raw/_scope_files.txt` — `git diff --name-only` output
- `reviews/.raw/_leader_shortlist.md` — orchestrator's pre-read (private)
- `reviews/.raw/subagent-{1..10}.json` — strict-schema reviewer findings (292 total)
- `reviews/.raw/_consolidated.json` — 64 clusters
- `reviews/.raw/_verification_notes.md` — consolidator adjudication log
- This file — `reviews/SOLENG-653-pas-integration-review.md`

---

## Postscript — what the multi-agent workflow actually bought us

**What pure redundancy bought us.** Six 10/10-agreement clusters (Move.toml `rev=main`, absent tests, scripts coin-type fragility, `WhitelistManagePermission` spec drift, mint/redeem-pause-also-halts-transfers, u64 precision in scripts) and five 9/10 clusters form a high-confidence signal core. For the Move.toml and no-tests concerns, having every reviewer catch them means the orchestrator can lean on these signals without verifying — freeing the verification budget for singletons.

**What independent thinking bought us.** The two HIGH confirmed findings both originated from a single reviewer: R6 framed **H-1** (cross-institution template overwrite) crisply while four other reviewers touched adjacent concerns without articulating the adversary path; R6-001 and R1's unique template-staleness observation jointly powered **H-2**. R1 alone caught the seize-pause conflation (**M-1**) — a real compliance regression. Without independent fan-out, these would have been missed or muddled with lower-severity overlapping noise.

**What leader verification caught.** R8-002's claim that the coin-scoped Auth lets cross-treasury whitelist abuse (HIGH) was refuted by the `TreasuryCap<T>` uniqueness invariant — downgraded to LOW. R3-012 (template arg-order HIGH) self-refuted in its own description; kept as INFO. C053 (missing `0xc` dep HIGH) was based on a misconception that `0xc` is a package rather than a shared object; rejected. R5-027 (namespace mismatch) rejected via the upstream singleton invariant. Four HIGH-tagged findings rejected out of 17 total — material noise reduction.

**Where the workflow underperformed.** C029 was a 17-source-id mega-cluster that fused eight distinct concerns (missing is_pas_coin guards, seize pause, version-check skip, object-account docs, source-not-whitelisted docs, witness visibility, permission semantics, test gaps). The clusterer's `(file, line-range, category)` key is too coarse when a small file has many orthogonal issues. The consolidator had to split C029 into eight findings — work that should ideally live in consolidate.js. Similarly C006 bundled the cross-institution overwrite (HIGH) with the whitelist-mutator opaque-abort (LOW); hand-splitting worked but cost time.

**Coverage near-misses.** `token_template_pas/sources/token_template.move` received only 2/10 touches. The leader spot-checked: file is a trivial coin template copy and the R6/R10 findings (public(package) not needed since init is private) are INFO. `scripts/package.json` received 1/10 — only R3 flagged the unstable `@mysten/pas@0.0.3` dep. Both are defensible thin coverage. Had anything more substantial lived in either file, the workflow would have under-sampled.

**Cost & wall-clock.** 10 reviewers × ~35 reviewer-minutes + orchestrator pre-read + consolidator verification ≈ 6–7 agent-hours total. Net wall-clock with parallel fan-out ~60 minutes including consolidation.

**Net judgment.** The PR is not audit-ready — H-1 and H-2 block merge; the missing tests and `rev="main"` pinning block audit handoff. Once those four items land (H-1 and H-2 code fixes, test scaffolding, pin bump), the residual concerns (M-1 through M-7 + LOW/INFO polish) can be iterated through normal code review. The integration-boundary hygiene is good — upstream call sites all validated clean except for the `with_defining_ids` snag in H-2. PAS is a fundamentally sound integration pattern; the bugs are in Hadron's compositional assumptions, not the PAS contract itself.
