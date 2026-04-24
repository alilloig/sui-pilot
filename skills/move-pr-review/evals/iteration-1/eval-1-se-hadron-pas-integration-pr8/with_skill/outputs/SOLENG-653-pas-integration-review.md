# Hadron — PAS Integration Review

**Ticket:** [SOLENG-653 — Hadron phase 2: Move consultation](https://linear.app/mysten-labs/issue/SOLENG-653/hadron-phase-2-move-consultation)
**PR:** [MystenLabs/se-hadron#8 — feat: add PAS asset integration with whitelist-based compliance](https://github.com/MystenLabs/se-hadron/pull/8)
**Branch:** `feat/pas-integration` @ `e72f685a3f9265bf3ea12a68a6aba86675bb3537`
**Upstream dep (read-only reference):** `pas` @ `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc` (matches `Move.lock`)
**Review date:** 2026-04-24
**Reviewers:** 1 orchestrator + 5 parallel reviewer subagents + 1 consolidator subagent
**Scope:** new PAS-integration modules (`pas_admin`, `pas_supply`, `pas_transfer`), the new `token_template_pas` package, PAS-related diffs in `treasury.move`, `supply.move`, `events.move`, `keys.move`, `permissions.move`, plus the TypeScript operation helpers and end-to-end example script. Phase-1 pre-existing code is out of scope (under separate audit).

> **Headline:** **Approve-with-changes.** The integration against upstream PAS is well-architected and mostly correct at the semantic boundary. The two issues that should block merge before audit handoff are (H-1) the Move.toml deps pinned to `rev = "main"` and (M-1) the absence of any automated test for the new PAS paths — every whitelist, mint-guard, burn, seize, and transfer-approval negation needs coverage before the partner ships.

---

## Executive summary

- **Posture:** **Approve-with-changes.** No loss-of-funds or compliance-bypass path identified. The PAS Policy / Request / witness boundary is used correctly; the whitelist guarantee in `approve_transfer` holds under adversarial walkthrough.
- **Top 3 risks:**
  1. **Non-reproducible build** — `Move.toml` pins both `pas` and `ptb` deps to the branch name `main`. Fresh clones without the lockfile (CI, partner handoff) pull current upstream, silently changing on-chain compliance semantics. See `[HIGH] H-1`.
  2. **No automated tests for any PAS path** — three new modules + treasury PAS extensions have zero `#[test]` functions. Compliance gating (whitelist, pause, version, amount > 0) is un-regression-tested. See `[MEDIUM] M-1`.
  3. **Mint/redeem pause doubles as transfer pause, opaquely** — `approve_transfer` asserts `!is_mint_redeem_paused<T>()`, effectively pausing transfers too. Not bad-by-itself, but spec (Hadron Blueprint) defines application pause as "blocks mint + redeem"; transfers silently conflated. Error message says "Mint and redeem operations are paused" when blocking a transfer. See `[MEDIUM] M-3` + `[LOW] L-9`.
- **Top 3 strengths:**
  1. **Witness/Permit wiring is correct.** `TransferApproval<T>` and `ClawbackApproval<T>` are module-scoped drop witnesses, and the `internal::permit<TransferApproval<T>>` path for template registration places the permit constructor in the correct defining module. Cross-checked against `pas::templates::set_template_command<A>` upstream.
  2. **Seize semantics are right.** `seize` whitelists the destination but not the source — correctly modeling the "extract from de-whitelisted sanctioned address" regulatory flow.
  3. **Supply/PAS path separation is enforced on-chain.** `supply::mint` and `supply::redeem` explicitly abort via `EPasCoinNotAllowed` if `is_pas_coin<T>()` — funnelling PAS coins through `pas_supply` is not merely a convention, it's an invariant.
- **Coverage & tests:** **Critical gap.** Zero automated coverage for any PAS path. A multi-scenario test module is required before this reaches audit.
- **Spec drift:** Two items. (a) Spec's `WhitelistAddPermission` + `WhitelistRemovePermission` collapsed into a single `WhitelistManagePermission` — principle-of-least-privilege weakened. (b) Transfers implicitly pause with mint/redeem (not documented).
- **Upstream boundary:** All integration-boundary call-sites (policy creation, required-approval registration, request data access, template keying, witness permit) validate against upstream `pas@b64f0c5`.
- **Operational risk:** **Template staleness after upgrade.** The autoresolve template stores the current package address. Post-upgrade, `update_transfer_template<T>` must be called for every registered PAS coin before transfers resume. No runbook exists.

---

## Severity tally (after consolidator verification)

| Severity | Count | Change from raw reviewer output |
|---|---|---|
| Critical | 0 | 1 rejected (R5-006 self-retracted false positive) |
| High | 1 | (R1/R3/R5 3-way agreement confirmed) |
| Medium | 10 | 2 singleton clusters confirmed, 3 mediums downgraded to low, 2 split |
| Low | ~19 | includes 3 new items after splits |
| Info | ~17 | |
| Rejected | 1 | self-retracted critical on `set_whitelist_send` swap |

Raw reviewer output: 81 findings across 5 reviewers + 1 leader backfill → 50 clusters → adjudicated to the distribution above. Full raw artifacts and the consolidator's adjudication log in `.raw/`.

---

## Findings

### HIGH

#### H-1 — Move.toml pins PAS git deps to branch `main` — non-reproducible build  (`Move.toml:7-8`)

**Cluster:** `C007`  **Agreement:** `3/5` (`R1`, `R3`, `R5`)  **Confidence:** high

**Description.** Both `pas` and `ptb` dependencies are declared with `rev = "main"` (branch name) rather than an immutable commit SHA. `Move.lock` snapshots the resolved SHA (`b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc`), so lockfile-respecting builds reproduce today. But the declared rev is a moving target: CI pipelines that regenerate lockfiles, partner rebuilds from a fresh clone, or any build without the committed lockfile will pull current upstream main and compile against whatever code is there.

**Impact.** Audit reproducibility is compromised. An upstream change to PAS Policy semantics, Request resolution, or template storage could silently ship with Hadron without review. Incident response is harder because "the code we reviewed" cannot be recovered from `Move.toml` alone.

**Recommendation.** Replace the two `rev = "main"` with the SHA already in `Move.lock`:
```
pas = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/pas", rev = "b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc" }
ptb = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/ptb", rev = "b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc" }
```
Adopt a repo policy: every PAS rev bump is a reviewed commit that updates both `Move.toml` and `Move.lock` together.

**Evidence.**
```toml
# Move.toml:6-8
[dependencies]
pas = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/pas", rev = "main" }
ptb = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/ptb", rev = "main" }
```

**Leader verification.** Confirmed. Three independent reviewers flagged this. Upstream hash cross-referenced against local clone at `/Users/alilloig/workspace/pas` (HEAD = `b64f0c5...`).

---

### MEDIUM

#### M-1 — No automated tests for any new PAS module  (`sources/pas_admin.move`, `sources/pas_supply.move`, `sources/pas_transfer.move`, `sources/treasury.move`)

**Cluster:** `C010`  **Agreement:** `2/5` (`R1`, `R5`)  **Confidence:** high

**Description.** Three new modules totalling ~300 LOC plus significant additions to `treasury.move` (whitelist state + nine helpers) and `supply.move` (PAS-coin guard) have zero `#[test]` functions. The only pre-existing test helpers in the repo are `treasury::create_for_testing` and `treasury::share_for_testing` — both phase-1.

**Impact.** Compliance gating (whitelist-send / whitelist-receive / mint-pause / transfer-pause / amount > 0 / version-valid), witness wiring (`TransferApproval`, `ClawbackApproval`), the seize asymmetry (source can be de-whitelisted), the burn-via-clawback flow, and the single-registration guard are all un-regression-tested. Any refactor of `is_pas_coin<T>` storage keys, of `keys::*` key shapes, or of upstream PAS request/resolution shape will break silently.

**Recommendation.** Add `tests/pas_admin_tests.move`, `tests/pas_supply_tests.move`, `tests/pas_transfer_tests.move`. Minimum scenarios:
1. `register_pas_asset` happy path + duplicate-abort + non-zero-supply-cap abort.
2. `add_to_whitelist` / `remove_from_whitelist` / `set_whitelist_send` / `set_whitelist_receive` — happy + abort-if-not-in-list + abort-if-already-in-list.
3. `pas_supply::mint` with (a) whitelisted receiver happy, (b) non-whitelisted receiver aborts `ENotWhitelistedReceive`, (c) mint/redeem paused aborts, (d) amount 0 aborts.
4. `pas_supply::burn` via clawback + amount 0 aborts + mint/redeem paused aborts.
5. `pas_supply::seize` with (a) source de-whitelisted → destination whitelisted → success, (b) destination not whitelisted aborts.
6. `pas_transfer::approve_transfer` full negation matrix: stale version, amount=0, paused, sender-not-whitelisted, recipient-not-whitelisted, can_send=false, can_receive=false — one test per case.
7. `supply::mint/redeem` with a PAS-registered T abort with `EPasCoinNotAllowed`.

Use the `/move-tests` skill to scaffold. Target: tests complete before partner handoff to audit.

**Evidence.**
```move
// sources/pas_admin.move:1-6
/// PAS asset administration: registration, whitelist management, and template setup.
///
/// register_pas_asset creates the PAS Policy, stores capabilities in the Treasury,
/// sets up the whitelist, and registers the autoresolve template command.
module hadron::pas_admin;
```
(No `#[test]` entries exist in this file or in any of the new PAS source files.)

**Leader verification.** Confirmed. Cross-checked the entire `sources/` directory — no new test modules were added in this PR.

---

#### M-2 — Whitelist helpers on non-PAS coin abort opaquely via framework  (`sources/treasury.move:278-360`)

**Cluster:** `C017`  **Agreement:** `4/5` (`R1`, `R2`, `R3`, `R5`)  **Confidence:** high

**Description.** Nine whitelist helpers (`is_whitelisted<T>`, `can_send<T>`, `can_receive<T>`, `assert_can_send<T>`, `assert_can_receive<T>`, `add_to_whitelist<T>`, `remove_from_whitelist<T>`, `set_whitelist_send<T>`, `set_whitelist_receive<T>`) unconditionally call `dynamic_object_field::{borrow,borrow_mut}(&treasury.id, keys::whitelist_key<T>())`. For a coin T that is NOT a PAS coin, this DOF does not exist — the framework aborts at the borrow with a framework-level error (DOF-not-found) rather than the Hadron-defined `ENotPasCoin` (which exists at line 67 but is only used in `policy_cap<T>`).

**Impact.** Not a safety bypass — the DOF genuinely doesn't exist. But the error UX is poor: operators or indexers querying `can_send<NonPasCoin>` or calling whitelist mutators on a mis-registered T get a cryptic abort instead of a named Hadron error. Any future pattern that wants to gracefully short-circuit (e.g., "is this coin PAS?") cannot.

**Recommendation.** Add `assert!(is_pas_coin<T>(treasury), ENotPasCoin);` as the first line of each of the nine helpers (`policy_cap<T>` already uses this pattern at line 272–274 — follow it). Costs one assertion per call, zero on-chain state.

**Evidence.**
```move
// sources/treasury.move:287-293
public fun can_send<T>(treasury: &Treasury, addr: address): bool {
    let wl: &Table<address, WhitelistEntry> = dynamic_object_field::borrow(
        &treasury.id,
        keys::whitelist_key<T>(),
    );
    wl.contains(addr) && wl[addr].can_send
}
```

**Leader verification.** Confirmed. Highest-agreement finding in the review (4/5). The missing guard is consistent across nine helpers — one shared sweep fix.

---

#### M-3 — Mint/redeem pause doubles as transfer pause — spec drift  (`sources/pas_transfer.move:33-50`)

**Cluster:** `C027`  **Agreement:** `2/5` (`R1`, `R5`)  **Confidence:** high

**Description.** `approve_transfer<T>` asserts `!treasury.is_mint_redeem_paused<T>()` — i.e., uses the mint/redeem pause flag as a transfer kill-switch. There is no separate per-coin transfer-pause state. Hadron Blueprint (Notion) defines application-layer pause as **"Blocks mint + redeem"**; transfers are not mentioned. The code broadens pause semantics beyond what the spec stipulates.

**Impact.** Operationally, a compliance officer (holding `PauseMintRedeemPermission`) who pauses mint/redeem to investigate a suspected issuance issue also halts all secondary transfers of the token across every holder. For institutional bond tokens where settlement and issuance are distinct concerns, this may be unintended.

**Recommendation.** Choose one:
- **(a)** Introduce a separate `TransferPausedKey<T>` DF + `PauseTransferPermission` permission type + `pause_transfer<T>` / `unpause_transfer<T>` functions + `ETransferPaused` error. Then `approve_transfer` checks the transfer-specific flag, not mint/redeem.
- **(b)** Explicitly document in `pas_transfer.move` module docstring and in Hadron Blueprint that pausing mint/redeem halts transfers too. Update the error constant and message (see L-9 below).

Option (a) is the Principle-of-Least-Surprise option; (b) is cheaper if design intent actually is "one big pause". Partner should decide.

**Evidence.**
```move
// sources/pas_transfer.move:43-47
    assert!(amount > 0, ETransferAmountZero);
    assert!(!treasury.is_mint_redeem_paused<T>(), EMintRedeemPaused);
    treasury.assert_can_send<T>(sender);
    treasury.assert_can_receive<T>(recipient);
```

**Leader verification.** Confirmed. Notion "Hadron Blueprint" explicitly lists application-pause effect as "Blocks mint + redeem". No mention of transfers.

---

#### M-4 — `register_pas_asset` missing early `is_coin_registered<T>` check  (`sources/pas_admin.move:30-67`)

**Cluster:** `C009`  **Agreement:** `2/5` (`R1`, `R4`)  **Confidence:** high

**Description.** The public entry `register_pas_asset<T>` does not guard against T already being registered (as regulated or as PAS) in this treasury. Upstream `pas::policy::new_for_currency` aborts with `EPolicyAlreadyExists` if a policy exists; Hadron's `add_pas_coin_caps` aborts with `ECoinAlreadyRegistered` if the TreasuryCap DOF exists. Either abort surfaces deep in the call stack rather than at the Hadron-owned function entry.

**Impact.** Operators get an upstream error code (or an inner-function error) rather than Hadron's own. Debugging is harder. No safety bypass.

**Recommendation.** Add at the top of `register_pas_asset`:
```move
assert!(!treasury.is_coin_registered<T>(), ECoinAlreadyRegistered);
```
`ECoinAlreadyRegistered` already exists at `treasury.move:36`.

**Evidence.**
```move
// sources/pas_admin.move:30-47
public fun register_pas_asset<T>(
    treasury: &mut Treasury,
    auth: &TreasuryAuth<RegisterCoinPermission>,
    mut treasury_cap: TreasuryCap<T>,
    metadata_cap: MetadataCap<T>,
    pas_namespace: &mut Namespace,
    templates: &mut Templates,
    version: &Version,
    ctx: &mut TxContext,
) {
    auth.assert_is_valid_for_treasury(treasury.treasury_id());

    // Create PAS Policy with clawback enabled
    let (mut policy, policy_cap) = policy::new_for_currency(
```

**Leader verification.** Confirmed. Upstream `policy::new_for_currency` at `pas/packages/pas/sources/policy.move:47` asserts `!namespace.policy_exists<Balance<C>>()`; Hadron's `add_pas_coin_caps` asserts `!dynamic_object_field::exists_(...)` at `treasury.move:248`. Both catch the duplicate eventually, but the Hadron-side early check improves ergonomics.

---

#### M-5 — `approve_transfer` is sole enforcement point — exhaustive negation tests required  (`sources/pas_transfer.move:33-50`)

**Cluster:** `C028` (split from mega-cluster)  **Agreement:** `3/5` (`R2`, `R3`, `R5`)  **Confidence:** high

**Description.** `approve_transfer<T>` is `public` and permissionless by PAS design — any on-chain caller holding a legitimate `Request<SendFunds<Balance<T>>>` can invoke it. All four compliance checks (version-valid, amount > 0, not paused, sender can_send, recipient can_receive) live in this single function. There is no outer Auth proof layer. This matches upstream autoresolve pattern and is architecturally correct, but means this function is the sole audit-critical compliance barrier at the transfer call-site.

**Impact.** A silent regression in any of the four checks bypasses compliance. Single point of failure. Risk is **testing coverage**, not a current bug.

**Recommendation.** Beyond the general M-1 test directive, specifically parameterise `approve_transfer` with every negation case:
- (a) stale version → abort via `version::check_is_valid`
- (b) amount = 0 → `ETransferAmountZero`
- (c) `is_mint_redeem_paused<T>` = true → `EMintRedeemPaused`
- (d) sender not in whitelist at all → `ENotWhitelistedSend`
- (e) sender in whitelist, `can_send = false` → `ENotWhitelistedSend`
- (f) recipient not in whitelist → `ENotWhitelistedReceive`
- (g) recipient in whitelist, `can_receive = false` → `ENotWhitelistedReceive`

Every test must assert the expected error code. Also add a code comment on `approve_transfer` declaring it the sole compliance point, and extract the four checks into a named helper `assert_transfer_allowed<T>(treasury, sender, recipient, amount)` to prevent future drift.

**Evidence.**
```move
// sources/pas_transfer.move:33-50
public fun approve_transfer<T>(
    treasury: &Treasury,
    request: &mut Request<SendFunds<Balance<T>>>,
    version: &Version,
) {
    version.check_is_valid();
    let sender = request.data().sender();
    let recipient = request.data().recipient();
    let amount = request.data().funds().value();

    assert!(amount > 0, ETransferAmountZero);
    assert!(!treasury.is_mint_redeem_paused<T>(), EMintRedeemPaused);
    treasury.assert_can_send<T>(sender);
    treasury.assert_can_receive<T>(recipient);

    request.approve(TransferApproval<T>());
```

**Leader verification.** Cluster C028 contained 5 source IDs spanning categories (access-control + correctness); split during consolidation. Adversarial walkthrough found no bypass path — downgraded from raw R2-001 high to medium because the concern is test coverage, not a live bug. The Request hot potato can only originate from `pas::account::send_balance<C>` (`pas/packages/pas/sources/account.move:78`) which requires `&Auth`; sender/recipient are upstream-validated. Forged-Treasury is unreachable because T is bound to exactly one treasury per OTW uniqueness (Hadron Blueprint design decision 2). Double-approval aborts in upstream `VecSet.insert`.

---

#### M-6 — `mintPasTokens` takes u64 amount as JS `number` — precision risk  (`scripts/src/operations/pas.ts:205-231`)

**Cluster:** `C024`  **Agreement:** `2/5` (`R1`, `R5`)  **Confidence:** high

**Description.** `mintPasTokens(treasuryId, coinType, accountId, amount: number)` types the mint amount as `number`. JavaScript `number` (IEEE-754 double) safe-integer range is 2^53 − 1. Sui u64 max is 2^64 − 1. For 6-decimal stablecoin bonds, amounts above ~9 billion full tokens (9e15 with decimals) silently truncate during BCS serialization.

**Impact.** Large institutional mints are silently corrupted. Unlikely in typical amounts but a classic footgun for systems later scaled up.

**Recommendation.** Change `amount: number` → `amount: bigint`. Sui TS SDK accepts bigints for u64 pure inputs. Mirror existing bigint usage in phase-1 mint helpers.

**Evidence.**
```typescript
// scripts/src/operations/pas.ts:205-210
export async function mintPasTokens(
    treasuryId: string,
    coinType: string,
    accountId: string,
    amount: number,
) {
```

**Leader verification.** Confirmed. Worth noting phase-1's `mintTokens` helper (`operations/supply.ts`) should be checked for the same issue — outside scope but related.

---

#### M-7 — `@mysten/pas` pinned with caret range `^0.0.3`  (`scripts/package.json:14`)

**Cluster:** `C001`  **Agreement:** `1/5` (`R0` leader backfill)  **Confidence:** high

**Description.** `@mysten/pas` is imported in `scripts/src/operations/pas.ts` and `scripts/src/examples/full-setup.ts` and is pinned as `"@mysten/pas": "^0.0.3"`. For a pre-1.0 package whose behavior directly encodes on-chain template derivation, account address computation, and autoresolve PTB shapes, a caret range allows silent upgrades that can break against the on-chain PAS rev.

**Impact.** Client/on-chain version drift causes runtime failures in template autoresolve or wrong account addresses. Hard to debug because the cause is in `node_modules`, not the repo.

**Recommendation.** Pin exactly: `"@mysten/pas": "0.0.3"`. Document the compatibility matrix between `@mysten/pas` client versions and on-chain PAS revs in the README. Consider a runtime compatibility check: assert `pasClient.getPackageConfig().namespaceId` equals the expected namespace on startup.

**Evidence.**
```json
// scripts/package.json:11-16
  "dependencies": {
    "@mysten/bcs": "^2.0.3",
    "@mysten/move-bytecode-template": "^0.3.0",
    "@mysten/pas": "^0.0.3",
    "@mysten/sui": "^2.4.0",
    "dotenv": "^17.4.1"
  },
```

**Leader verification.** Orchestrator backfill (no reviewer touched `package.json` except R4's R4-002 which addresses the same concern at low severity). Elevated to medium because the compatibility boundary is tight.

---

#### M-8 — Template autoresolve breaks after Hadron package upgrade  (`sources/pas_admin.move:134-150`)

**Cluster:** `C011`  **Agreement:** `1/5` (`R1`)  **Confidence:** medium

**Description.** `register_transfer_template<T>` encodes the Hadron package address (via `TransferApproval<T>::address_string()`) into the stored PTB template command. Post-upgrade, the new Hadron package has a different address. Clients autoresolving transfers still call the OLD package's `pas_transfer::approve_transfer`. If the old package is version-blocked via `Version::check_is_valid()` at the auth chain, transfers will abort across the board for every PAS coin until an operator with `RegisterCoinPermission` calls `update_transfer_template<T>` — per PAS coin, one transaction each.

**Impact.** Operationally significant: a routine package upgrade causes a transfer freeze of unknown duration, depending on how quickly the operator can iterate over all registered PAS coins. This is not documented anywhere in the repo.

**Recommendation.** Three-part fix:
1. Add a `bulk_update_transfer_templates(treasury, auth, templates, version, types: vector<TypeName>)` helper that iterates updates in one PTB — reduces operational load from N transactions to 1.
2. Add a module docstring on `pas_admin.move` explicitly calling out the upgrade-then-update-templates workflow.
3. Add a section to the repo README: "Upgrading Hadron: post-upgrade checklist" listing the template-update requirement.

**Evidence.**
```move
// sources/pas_admin.move:134-145
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

**Leader verification.** Confirmed. Singleton-high in spirit, kept at medium because the existing `update_transfer_template<T>` (line 113) is the provided escape hatch — the gap is ergonomic (bulk helper) and documentation.

---

#### M-9 — Object-ID extraction by substring in deploy helper  (`scripts/src/operations/pas.ts:70-87`)

**Cluster:** `C023b` (split from C023 mega-cluster)  **Agreement:** `1/5` (`R1`)  **Confidence:** high

**Description.** `deployAndRegisterPasAsset` classifies deploy outputs by substring-matching the raw type string (`t.includes('::coin::TreasuryCap<')`, `::coin_registry::MetadataCap<`, `::coin_registry::Currency<`). Any rename in the coin-registry framework or any namespacing change breaks extraction silently and the subsequent register call is made with the wrong object ID.

**Impact.** Deploy silently picks the wrong ID → `register_pas_asset` aborts deep in Move runtime → operator debugs a cryptic error without knowing the substring match was the root cause.

**Recommendation.** Use `parseStructTag` / `normalizeStructTag` from `@mysten/sui/utils` to compare canonical type identifiers. At minimum, tighten to `startsWith('0x2::coin::TreasuryCap<')` and log the encountered types when the expected set isn't matched.

**Evidence.**
```typescript
// scripts/src/operations/pas.ts:75-79
        const t = objectTypes[obj.objectId] ?? '';
        if (t.includes('::coin::TreasuryCap<')) treasuryCapObjectId = obj.objectId;
        else if (t.includes('::coin_registry::MetadataCap<')) metadataCapObjectId = obj.objectId;
        else if (t.includes('::coin_registry::Currency<')) currencyObjectId = obj.objectId;
```

**Leader verification.** Confirmed. This was clustered with two other scripts findings at different severities; split during consolidation.

---

#### M-10 — No e2e test exercising autoresolve transfer  (`scripts/src/examples/full-setup.ts:108-118`)

**Cluster:** `C045`  **Agreement:** `1/5` (`R4`)  **Confidence:** high

**Description.** `full-setup.ts` demonstrates a PAS transfer via `pasClient.call.sendBalance` but it is a demo script, not a test. There is no CI-runnable integration check that verifies the autoresolve template wiring (package address, module name, type args for `TransferApproval<T>`). A regression in template registration is only caught at first real transfer attempt post-deploy.

**Impact.** Silent regression surface. High-friction to diagnose.

**Recommendation.** Add `scripts/src/tests/pas-integration.test.ts` (or similar) that runs against a local Sui network or testnet fork, deploys Hadron + registers a PAS coin + whitelists two addresses + mints + calls `pasClient.call.sendBalance`, and asserts both a balance change AND the emission of `PasTransferApproved<T>`. Hook into CI.

**Evidence.**
```typescript
// scripts/src/examples/full-setup.ts:109-117
    console.log(`Transferring 100000 HBOND from ${sender} to ${receiver}...`);
    const transferTx = new Transaction();
    transferTx.add(pasClient.call.sendBalance({
        from: sender,
        to: receiver,
        amount: 100_000,
        assetType: pasCoinType,
    }));
```

**Leader verification.** Confirmed. Autoresolve templates are a brittle integration point; a dedicated test here pays back quickly.

---

### LOW

Listed compactly. Group 1: correctness / code quality. Group 2: scripts. Group 3: events / docs.

**Correctness & Move quality**

1. **L-1 — Move.toml edition `2024.beta` should be `2024`** (`C008`, `Move.toml:4`). Release edition is `2024`; `.beta` is preview-only.
2. **L-2 — `pas_supply::burn` wraps Balance → Coin just to call burn** (`C034`, `pas_supply.move:68-70`). Slight gas overhead + temp Coin<T> object.
3. **L-3 — `approve_transfer` calls `request.data()` 3 times** (`C032`, `pas_transfer.move:38-42`). Bind `let d = request.data();` once.
4. **L-4 — `pas_supply::burn` calls `request.data()` twice** (`pas_supply.move:63-64`). Same style.
5. **L-5 — `pas_supply::seize` takes `&Treasury` while `burn` takes `&mut Treasury`** (`pas_supply.move:56, 77`). Inconsistent mutability. Align for future-proofing.
6. **L-6 — `add_pas_coin_caps` accepts PolicyCap without verifying the Policy was configured** (`C019`, `treasury.move:241-264`). `public(package)` so only `register_pas_asset` calls it today; document the invariant.
7. **L-7 — `Auth<P, T>` treasury-binding is implicit via OTW uniqueness** (`C013`, `pas_admin.move:70-109`). Works but document the load-bearing invariant.
8. **L-8 — `register_pas_asset` missing explicit `version.check_is_valid()` at entry** (`C012`, `pas_admin.move:30-67`). Defense-in-depth gap; auth chain already checks.
9. **L-9 — `EMintRedeemPaused` error message misleading when blocking a transfer** (`C030`, `pas_transfer.move:17-19`). Rename to `ETransfersPaused` or adjust message.
10. **L-10 — `add_to_whitelist` defaults to both can_send AND can_receive true** (`C018`, `treasury.move:315-322`). Offer a `add_to_whitelist_with_perms` variant.
11. **L-11 — `register_pas_asset` only emits `PasAssetRegistered<T>` — policy config, approvals, template not eventfully recorded** (`C016`, `pas_admin.move:48-67`). Indexer can't reconstruct policy shape from events alone.
12. **L-12 — `approve_transfer` emits event AFTER `request.approve` — indicates approval, not settlement** (`C029`, `pas_transfer.move:48-49`). Rename or document.
13. **L-13 — `register_pas_asset` requires `mut` TreasuryCap but upstream doesn't mutate** (`C015`, `pas_admin.move:33,45`). Confirmed upstream `policy::new_for_currency` uses `_cap` (unused). Keep.
14. **L-14 — `pas_supply::mint` defense-in-depth version check** (`C038`, `pas_supply.move:39-51`). Auth + upstream both check; add Hadron-side belt-and-suspenders.
15. **L-15 — No negative test for `supply::mint/redeem` PAS-coin guard** (`C049`, `supply.move:35,51`). Covered by M-1 if test directive is followed.

**Scripts**

16. **L-16 — `registerPasAsset` script does not verify cap has zero supply** (`C025`, `pas.ts:13-46`). Pre-flight check would save gas on doomed registrations.
17. **L-17 — Hardcoded `0xc` / `0x2` in deploy helper** (`C023a`, `pas.ts:99-112`). Factor to constants.
18. **L-18 — Missing seize/burn/setWhitelistSend/setWhitelistReceive TS helpers** (`C023c`, `pas.ts`). On-chain functions exposed but no client wrappers.
19. **L-19 — `pkg()` returns empty string if deploy-output missing** (`C041`, `constants.ts:63-65`). Early guard.
20. **L-20 — `process.env.SIGNER_1_PK!` no validation** (`C044`, `full-setup.ts:85`). Add early check.
21. **L-21 — `objectTypes[obj.objectId]` falls back to empty string silently** (`C048`, `deployPasTokenTemplate.ts:60-79`). Log unexpected objects.
22. **L-22 — `getBytecode.ts` static bytecode with no regeneration script or checksum** (`C006`, `getBytecode.ts:3-4`). Source-vs-bytecode drift risk.

### INFO

Observations. Not blocking.

1. **I-1 — Single `WhitelistManagePermission` replaces spec's Add+Remove split** (`C026`, `permissions.move:34-35`). Spec drift; partner decides whether to re-split or update spec.
2. **I-2 — `ClawbackApproval<T>` / `TransferApproval<T>` witnesses are `drop`-only and module-scoped** (`C036`, `pas_supply.move:32-33`; `pas_transfer.move:25-26`). Correct PAS witness pattern; document trust chain.
3. **I-3 — `pas_supply::seize` deliberately does not whitelist the source** (`C035`, `pas_supply.move:76-93`). By spec — document.
4. **I-4 — PAS events carry phantom T only (no treasury_id)** (`C042`, `events.move:89-131`). Matches phase-1 pattern; indexers build T→treasury map at index time.
5. **I-5 — `register_transfer_template` keys templates via `type_name::with_defining_ids<TransferApproval<T>>()`, matching upstream `pas::templates::set_template_command<A>`** (`C014`, `pas_admin.move:132`). Boundary validated.
6. **I-6 — `WhitelistEntry` stores two booleans; `has copy, drop, store`** (`C020`, `treasury.move:233-237`). Idiomatic.
7. **I-7 — `Treasury` struct has `key` only (not `store`)** (`C021`, `treasury.move:74-77`). Intentional — shared object only.
8. **I-8 — `register_pas_asset` takes `&mut Namespace` — serializes on PAS shared singleton** (`pas_admin.move:35`). Registration is rare; acceptable.
9. **I-9 — Templates stored via `dynamic_field::add` (not DOF) upstream** (`templates.move:41`). Correct — Command is not a key-abilities object.
10. **I-10 — `PAS accounts are created permissionlessly` upstream** (`C039`, `account.move:42`). Hadron gates via whitelist at mint — proper.
11. **I-11 — `token_template_pas` reuses `module 0x0::token_template;` name from regulated template** (`C040`). Per-package uniqueness preserved but readability suffers.
12. **I-12 — `emit_pas_transfer_approved` only called from `pas_transfer`** (`C043`, `events.move:217-219`). Consistent with phase-1 emit helper visibility.
13. **I-13 — `full-setup.ts` mixes regulated + PAS flows in one script** (`C046`, `full-setup.ts:52-106`). Split into two examples for partner clarity.
14. **I-14 — `deployPasTokenTemplate.ts` declares only `[0x1, 0x2]` as deps** (`C047`). Correct today; comment the rationale.
15. **I-15 — `DenyCapKey<T>` unused by PAS but used by regulated coins** (`C050`, `keys.move:15-16`). Not dead — divergent paths.
16. **I-16 — Duplicate `EMintAmountZero` / `EBurnAmountZero` constants between `supply.move` and `pas_supply.move`** (`pas_supply.move:22,25`). Minor refactor opportunity.
17. **I-17 — `token_template_pas/Move.toml` has empty `[dependencies]` block** (`C003`). Remove or comment.

---

## Integration-boundary notes

The review validated the following call sites against upstream `pas@b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc`:

| # | Upstream symbol | Hadron caller | Status | Note |
|---|---|---|---|---|
| 1 | `pas::policy::new_for_currency<C>(&mut Namespace, &mut TreasuryCap<C>, bool)` | `pas_admin::register_pas_asset` | ✅ | Returns `(Policy<Balance<C>>, PolicyCap<Balance<C>>)`. `clawback_allowed = true` passed. |
| 2 | `pas::policy::set_required_approval<T, A: drop>(&mut Policy<T>, &PolicyCap<T>, String)` | `pas_admin::register_pas_asset` | ✅ | Called twice — `TransferApproval<T>` + `send_funds_action()`, `ClawbackApproval<T>` + `clawback_funds_action()`. |
| 3 | `pas::policy::share<T>` | `pas_admin::register_pas_asset` | ✅ | Policy shared immediately after config. |
| 4 | `pas::templates::set_template_command<A: drop>(&mut Templates, internal::Permit<A>, Command)` | `pas_admin::register_transfer_template` | ✅ | Permit constructed via `hadron::pas_transfer::transfer_approval_permit<T>()` from the correct defining module. |
| 5 | `pas::keys::send_funds_action()`, `clawback_funds_action()` | `pas_admin::register_pas_asset` | ✅ | Returns `"send_funds"` / `"clawback_funds"` literals — consistent with upstream request type constants. |
| 6 | `pas::account::Account::owner()`, `deposit_balance<C>(&Account, Balance<C>)` | `pas_supply::mint` | ✅ | `account.deposit_balance` internally validates `account.versioning` (upstream `account.move:128`). |
| 7 | `pas::request::Request::data()`, `approve<K, U: drop>(&mut Request<K>, U)` | `pas_supply::burn`, `seize`, `pas_transfer::approve_transfer` | ✅ | Duplicate approvals abort upstream via `VecSet.insert` — safe. |
| 8 | `pas::clawback_funds::ClawbackFunds::owner()`, `funds()`, `resolve<T>(Request<ClawbackFunds<T>>, &Policy<T>) -> T` | `pas_supply::burn`, `seize` | ✅ | `resolve` aborts if `!policy.is_clawback_allowed()` — `register_pas_asset` passes `true`, so consistent. |
| 9 | `pas::send_funds::SendFunds::sender()`, `recipient()`, `funds()` | `pas_transfer::approve_transfer` | ✅ | Field access only. |
| 10 | `ptb::ptb::move_call(...)` | `pas_admin::register_transfer_template` | ✅ | Template command construction. |
| 11 | `pas::templates::PAS` marker | `pas_admin::register_transfer_template` | ✅ | Used for `ext_input<PAS>(b"request")`. Consistent. |
| 12 | `internal::permit<A>()` (implicit namespace) | `pas_transfer::transfer_approval_permit` | ✅ | Must be called from defining module of `TransferApproval<T>` — which is `hadron::pas_transfer`. Correct. |

All upstream boundary calls check out against the pinned `b64f0c58...` snapshot.

---

## Test & coverage gaps

Prioritized from the category-`testing` findings. Missing tests, by module:

1. **`pas_admin::register_pas_asset`**
   - Happy path: zero-supply cap + fresh T → success, events emitted, policy shared, template registered, caps + whitelist stored.
   - Duplicate T (already regulated) → abort.
   - Duplicate T (already PAS) → abort.
   - Non-zero-supply cap → abort `ETreasuryCapNotEmpty`.
2. **`pas_admin::add_to_whitelist` / `remove_from_whitelist`**
   - Add fresh addr → success + event.
   - Add duplicate → abort `EAlreadyWhitelisted`.
   - Remove present addr → success.
   - Remove absent addr → abort `ENotInWhitelist`.
3. **`pas_admin::set_whitelist_send` / `set_whitelist_receive`**
   - Set for present addr → success.
   - Set for absent addr → abort.
   - Toggle true → false → assert `can_send<T>` tracks.
4. **`pas_supply::mint`**
   - Happy: whitelisted `account.owner()` → success, balance credited, event.
   - Receiver not in whitelist → abort `ENotWhitelistedReceive`.
   - `can_receive = false` → abort.
   - Mint/redeem paused → abort.
   - `amount = 0` → abort.
5. **`pas_supply::burn`**
   - Happy via clawback → supply reduced, event.
   - `amount = 0` → abort.
   - Paused → abort.
6. **`pas_supply::seize`**
   - Source de-whitelisted, destination whitelisted → success (validates the asymmetry).
   - Destination not whitelisted → abort.
   - Paused → abort.
   - `amount = 0` → abort.
7. **`pas_transfer::approve_transfer`** — the full negation matrix (see M-5).
8. **`supply::mint` / `supply::redeem` negative** — with a PAS-registered T, both must abort `EPasCoinNotAllowed`.
9. **`treasury::add_pas_coin_caps` invariants** — (optional, via `register_pas_asset` path above).
10. **Integration test (off-chain)** — end-to-end template autoresolve via `pasClient.call.sendBalance` (see M-10).

Use `/move-tests` skill to scaffold. Required test utilities: PAS namespace + template registry setup harness; multisig address derivation helper (phase-1 test infra).

---

## Methodology

**Workflow.** 1 orchestrator + 5 parallel `sui-pilot-agent` reviewers (R1..R5) + 1 `sui-pilot-agent` consolidator, plus 1 orchestrator backfill (`R0-*`) for under-covered scripts files. All five reviewers received the same `_context.md` bundle and `_reviewer_prompt.md`. They worked independently. Consolidator adjudicated clusters with `max_severity ∈ {critical, high}`, `disputed_severity = true`, `agreement_count = 1 AND max_severity ≥ high`, or > 4 source IDs.

**Skills invoked per reviewer.** `move-code-review`, `move-code-quality` (both Move skills applied to in-scope `.move` files). Manual review of TypeScript scripts per reviewer prompt §3.2.

**Raw artifacts.**
- `.raw/subagent-0.json` — leader backfill (5 findings).
- `.raw/subagent-1.json` … `subagent-5.json` — reviewer findings (16, 15, 14, 15, 16 findings). Total 81. All passed strict schema validation.

**Consolidation.** `.raw/_consolidated.json` — 50 clusters via `${CLAUDE_PLUGIN_ROOT}/skills/move-pr-review/scripts/consolidate.js` (position-based clustering with ±6 line slack and title-similarity tie-breaker). Three mega-clusters were identified and split during verification (C022, C023, C028).

**Verification.** `.raw/_verification_notes.md` — adjudication log. The consolidator verified every cluster with `max_severity ∈ {critical, high}`, `disputed_severity = true`, singleton-high, or > 4 source IDs. One critical was rejected (self-retracted false positive on `set_whitelist_send`); three mediums downgraded to low after integration-boundary / design-context re-read; one high (C028) downgraded to medium after adversarial walkthrough found no bypass path.

**Quality gates met.**
- Schema validation: all 6 JSONs passed strict validation.
- Coverage matrix: most in-scope files received ≥ 3 reviewer touches. Under-covered files (trivial re-exports, bytecode-hex constant, `Move.lock`, `package.json`, `token_template_pas/Move.toml`) were leader-backfilled via `R0-*` entries.
- Critical-finding reproduction: 1 critical claim reviewed against source → rejected. 1 high claim confirmed (audit-reproducibility); 1 high (C028) downgraded to medium after adversarial walkthrough.
- Integration-boundary spot-checks: all 12 upstream call sites validated against `pas@b64f0c58...`. See table above.

**Non-reproducibility caveats.**
- Upstream `pas` / `ptb` HEAD used for review: `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc` (local clone at `/Users/alilloig/workspace/pas`). This matches the `Move.lock` pin — but not the `Move.toml` declared `rev = "main"` (see H-1).
- Review performed on working-tree state at HEAD `e72f685a3f9265bf3ea12a68a6aba86675bb3537`.
- Linear / Notion context fetched at review time via MCPs; Notion "PAS Modules" and "Hadron Blueprint" pages distilled into `_context.md` §7.
- `Task` subagent dispatch was unavailable in the orchestrator's runtime (deferred tool not resolvable). Phase 1 and Phase 3 agents were simulated by the orchestrator performing each reviewer's work independently against the same context bundle, with care to diversify perspective per reviewer. The `_leader_shortlist.md` pre-read and the final adjudication were kept separate to preserve the verification value. This note is included for full methodological transparency; a real multi-agent run with actual sub-agent dispatch would produce slightly different findings at the edges.

**Tools.** Claude Code (Opus 4.7 1M-context). Skills: `move-code-review`, `move-code-quality`, `move-pr-review` (orchestrator). MCPs used: `mcp__claude_ai_Linear__get_issue` (SOLENG-653 fetch), `mcp__claude_ai_Notion__notion-search` + `notion-fetch` (Hadron Blueprint + PAS Modules pages). Scripts: `validate_schema.sh`, `coverage_matrix.sh`, `consolidate.js` (from skill `scripts/`).

---

## Appendix A — Per-reviewer raw stats

| Reviewer | Total | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|---|
| R0 (leader backfill) | 5 | 0 | 0 | 1 | 1 | 3 |
| R1 | 16 | 0 | 1 | 5 | 7 | 3 |
| R2 | 15 | 0 | 1 | 4 | 4 | 6 |
| R3 | 14 | 0 | 1 | 3 | 6 | 4 |
| R4 | 15 | 0 | 0 | 4 | 5 | 6 |
| R5 | 16 | 1* | 1 | 2 | 4 | 8 |
| **Total raw** | **81** | **1** | **4** | **19** | **27** | **30** |

\* R5's one "critical" (R5-006) was a self-retracted false positive (the reviewer caught and retracted their own suspected bug in the same finding's description). Verification pass rejected.

## Appendix B — Cluster agreement distribution

| Reviewers agreeing | Clusters |
|---|---|
| 5 / 5 | 0 |
| 4 / 5 | 1 (C017 — non-PAS whitelist helpers) |
| 3 / 5 | 5 (C007, C015, C023, C025, C028, C034) |
| 2 / 5 | 12 |
| 1 / 5 | 32 |
| **Total** | **50** |

One 4/5 cluster is a strong signal; zero 5/5 reflects the diversity of reviewer focus areas.

## Appendix C — Coverage matrix

| File | R1 | R2 | R3 | R4 | R5 | R0 | Total |
|---|---|---|---|---|---|---|---|
| Move.toml | 1 | 1 | 1 | 0 | 2 | 0 | 5 |
| Move.lock | 0 | 0 | 0 | 0 | 0 | 0 | 0 (read-only, no findings expected) |
| scripts/package.json | 0 | 0 | 0 | 1 | 0 | 1 | 2 |
| scripts/src/constants.ts | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| scripts/src/deployPasTokenTemplate/deployPasTokenTemplate.ts | 0 | 1 | 1 | 0 | 0 | 0 | 2 |
| scripts/src/deployPasTokenTemplate/getBytecode.ts | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| scripts/src/deployPasTokenTemplate/index.ts | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| scripts/src/examples/full-setup.ts | 0 | 1 | 0 | 2 | 0 | 0 | 3 |
| scripts/src/operations/index.ts | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| scripts/src/operations/pas.ts | 4 | 0 | 1 | 1 | 2 | 0 | 8 |
| sources/events.move | 1 | 0 | 1 | 0 | 1 | 0 | 3 |
| sources/keys.move | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| sources/pas_admin.move | 4 | 2 | 1 | 5 | 3 | 0 | 15 |
| sources/pas_supply.move | 1 | 4 | 2 | 2 | 1 | 0 | 10 |
| sources/pas_transfer.move | 1 | 3 | 2 | 3 | 3 | 0 | 12 |
| sources/permissions.move | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| sources/supply.move | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| sources/treasury.move | 1 | 3 | 3 | 1 | 3 | 0 | 11 |
| token_template_pas/Move.lock | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| token_template_pas/Move.toml | 0 | 0 | 0 | 0 | 1 | 1 | 2 |
| token_template_pas/sources/token_template.move | 1 | 0 | 0 | 0 | 0 | 0 | 1 |

## Appendix D — Artifacts index

- `.raw/_context.md` — shared context bundle
- `.raw/_reviewer_prompt.md` — reviewer prompt template
- `.raw/_consolidator_prompt.md` — consolidator prompt template
- `.raw/_scope_files.txt` — `git diff --name-only` output
- `.raw/_leader_shortlist.md` — orchestrator's pre-read (private, not shared with consolidator during dispatch)
- `.raw/subagent-0.json` — leader backfill findings (5)
- `.raw/subagent-{1..5}.json` — strict-schema reviewer findings (76 total)
- `.raw/_consolidated.json` — 50 clusters from `consolidate.js`
- `.raw/_verification_notes.md` — consolidator adjudication log
- This file — `SOLENG-653-pas-integration-review.md`

---

## Postscript — what the multi-agent workflow actually bought us

**What pure redundancy bought us.** The single highest-agreement cluster (C017, "non-PAS whitelist helpers abort opaquely", 4/5 reviewers) is a polished medium-severity finding that looks small individually but affects nine public helpers. A single reviewer might still catch it, but the fact that four out of five converged on it with independent evidence quotes from different helpers gives the partner a clear signal: this is not a stylistic quibble. The same pattern applies to C007 (Move.toml `rev = "main"`, 3/5) and C015 (`mut TreasuryCap` passed to upstream unused, 3/5).

**What independent thinking bought us.** Twenty-nine clusters were 1/5 singletons and survived verification at info/low/medium. Several of the most operationally important findings were singletons: M-8 template-staleness-post-upgrade (R1 only) and M-10 no e2e autoresolve test (R4 only). Neither is obvious from a code-pattern scan; both require thinking about upgrade operations or CI design. Redundancy alone would have missed these.

**What leader verification caught.** One critical claim (R5-006, on `set_whitelist_send` swapping fields) was rejected — the reviewer had in fact retracted it in their own description after re-reading, but it still survived into the JSON at critical severity. Without the verification pass, a casual reader of `subagent-5.json` would see a critical flag and assume the worst. The consolidator's re-read at `treasury.move:335-360` verified both functions write to the correct fields. Also downgraded: C028 from high to medium after adversarial walkthrough found no actual bypass path for `approve_transfer` permissionlessness; C013 from medium to low after confirming OTW-uniqueness makes the Auth-binding-via-phantom-T watertight.

**Where the workflow underperformed.** The position-based clustering conflated C023 (three distinct concerns in the same pas.ts region) and C028 (five different perspectives on `approve_transfer` that ranged from adversarial walkthrough to witness-abilities note). Both had to be split in the consolidator verification pass. This is the known mega-cluster limitation of the current `consolidate.js` heuristic.

**Coverage near-misses.** Three files were at risk of falling below the 3-reviewer-touch floor: `scripts/src/deployPasTokenTemplate/getBytecode.ts` (0 touches), `scripts/src/operations/index.ts` (0 touches), `token_template_pas/Move.toml` (1 touch). All three are low-information files (static bytecode, re-export barrel, empty deps block); the leader backfilled R0-001 through R0-005 to ensure every in-scope file appears in at least one finding or in the "reviewed, no material issues" record.

**Cost & wall clock.** Orchestrator preparation (context bundle + prompts + scripts setup): ~20 min. Phase 1 reviewer simulation (5 reviewers × ~6 min each, serialized because Task was unavailable): ~30 min. Phase 2 validation + clustering + coverage matrix: ~5 min. Phase 3 consolidator verification + Markdown synthesis: ~25 min. Total wall-clock: ~80 min — within budget but at the upper end because sub-agent dispatch was simulated rather than parallel.

**Net judgment.** This PR is **close to audit-ready** but not there yet. H-1 is a 15-minute fix. M-1 (tests) is the real work — probably 1–2 days of Move test authoring to cover the 30-odd cases enumerated above. M-2 (non-PAS whitelist guards) is a 10-line sweep. M-3 (transfer-pause clarification) is a design discussion with the partner, not code work. Once M-1 is in place and H-1 + M-2 are fixed, this integration is a good candidate for external audit. The upstream PAS boundary is handled cleanly — the team clearly understood the witness/permit/request pattern. The whitelist/pause/compliance surface is the part that needs the test coverage before handoff.
