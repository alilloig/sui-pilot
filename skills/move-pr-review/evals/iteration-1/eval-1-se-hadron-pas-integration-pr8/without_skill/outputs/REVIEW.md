# Hadron — PAS Integration (PR #8) — Audit-Readiness Review

**Ticket:** SOLENG-653 (Hadron phase 2 — PAS integration)
**PR:** [MystenLabs/se-hadron#8](https://github.com/MystenLabs/se-hadron/pull/8) — `feat: add PAS asset integration with whitelist-based compliance`
**Branch:** `feat/pas-integration` @ `e72f685`
**PAS upstream pinned rev (observed in `Move.lock`):** `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc` — but `Move.toml` points at `rev = "main"` (see H-3)
**Review date:** 2026-04-24
**Reviewers:** 5 parallel lenses (Move-core / Treasury-storage / PAS-boundary / TypeScript-deploy / Tests-docs-adversarial) + 1 consolidator
**Scope:** Delta of PR #8 relative to `main`. Phase-1 code out of scope.
**Posture:** **Approve with changes.** Zero critical findings survive verification. Six HIGH findings warrant blocking merge.

---

## Executive summary

### Top-3 risks

1. **Pause flag conflates three regulatory levers (H-1).** `is_mint_redeem_paused<T>` gates supply, PAS transfer, AND seize. During an incident, a compliance officer must choose between halting issuance (and losing the ability to seize from a bad actor) or leaving issuance open. There is no way to freeze transfers while keeping seize live, or vice versa. This is the single most impactful operational defect and is one we've confirmed by reading every call-site of the flag.

2. **PolicyCap is stored but never actionable post-registration (H-5).** `register_pas_asset` deposits `PolicyCap<Balance<T>>` into the Treasury as a DOF, but no function — in `pas_admin`, `pas_supply`, `pas_transfer`, or anywhere else — ever borrows it to mutate the PAS Policy. Adjusting required approvals, syncing versioning after a PAS upstream version block, or adding a second-witness approval all require a full Hadron package upgrade. Incident response paths that should take minutes take a deploy cycle.

3. **Bytecode + upstream dep reproducibility (H-3 + H-6).** `Move.toml` pins `pas` and `ptb` to `rev = "main"`, so audit → deploy can traverse different upstream commits. Independently, `scripts/src/deployPasTokenTemplate/getBytecode.ts` ships an opaque 1.5KB hex constant that's the serialized compile output of `token_template_pas` — with no regeneration script and no CI check. Silent drift between Move source and shipped bytecode is a financial-grade deploy risk.

### Severity totals

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 6 |
| Medium | 15 |
| Low | 11 |
| Info | 5 |

### Verdict per area

| Area | Verdict | Dominant issues |
|---|---|---|
| Move access control & Auth | Approve with changes | Pause-flag conflation (H-1); `pas_supply` missing `is_pas_coin` guard (M-1) |
| Treasury/DOF/state | Approve with changes | PolicyCap unreachable (H-5); whitelist add forces full privileges (M-4) |
| PAS integration boundary | Approve with changes | unlock-action reliance is load-bearing and undocumented (M-6); `rev=main` pin (H-3) |
| TypeScript / deploy | Rework required | ID-extraction fragility (H-4); bytecode drift (H-6) |
| Tests | Blocker | Zero tests anywhere in the repo (H-2) |
| Events / observability | Approve with changes | PAS events lack correlation IDs (M-7) |

---

## Findings

Severity grading:
- **Critical:** direct loss of funds or unauthorized privileged action; exploit path today.
- **High:** ship-blocker for audit. Either ships with a known live exploit-adjacent defect, a reproducibility failure, or an incident-response gap.
- **Medium:** correctness, defense-in-depth, or UX defect that should be fixed before mainnet but does not block audit.
- **Low:** polish, style, non-exploit bugs.
- **Info:** spec/doc drift, observations.

Where file:line references appear, the code has been quoted in the "Evidence" block directly from the branch `feat/pas-integration` @ `e72f685`.

---

### HIGH

#### H-1 — `is_mint_redeem_paused<T>` conflates mint/redeem, PAS transfer, and PAS seize into one flag

- **Files:** `sources/pas_transfer.move:44`, `sources/pas_supply.move:46, 62, 83`, `sources/treasury.move:143-152`
- **Agreement:** Reviewer 1, Reviewer 5 (adversarial). Consolidated HIGH.
- **Description.** `MintRedeemPausedKey<T>` is a single `bool` dynamic field on the Treasury. Five call sites assert it:
  - `supply::mint`, `supply::redeem` — non-PAS supply. ✓ intended.
  - `pas_supply::mint`, `pas_supply::burn` — PAS supply. ✓ intended.
  - `pas_supply::seize` — regulatory clawback-and-redeposit. **✗** A regulatory recovery action should never be gated by the same flag that gates issuance.
  - `pas_transfer::approve_transfer` — every PAS transfer. **✗** There is no way to suspend transfers independently of issuance or vice versa.
- **Operational impact.** During an incident, the compliance officer's decision matrix is binary: pause (and lose seize + freeze the legitimate market) or don't pause (and let the attack continue). Contrast with the non-PAS path, where Sui's `DenyListV2` global pause is a separate lever from application-level mint/redeem pause.
- **Recommendation.**
  1. Introduce `TransferPausedKey<T>` as a distinct DF, asserted only from `pas_transfer::approve_transfer`.
  2. Remove `assert_mint_redeem_enabled<T>` from `pas_supply::seize`; regulatory recovery should not be gated by operational pause.
  3. Add `PauseTransferPermission` / `UnpauseTransferPermission` distinct from the mint/redeem ones.
  4. Rename `EMintRedeemPaused` in `pas_transfer.move` to a transfer-specific error (or reuse a renamed shared constant).
- **Evidence.**
```move
// sources/pas_transfer.move:42-46
assert!(amount > 0, ETransferAmountZero);
assert!(!treasury.is_mint_redeem_paused<T>(), EMintRedeemPaused);
treasury.assert_can_send<T>(sender);
treasury.assert_can_receive<T>(recipient);
```
```move
// sources/pas_supply.move:76-84
public fun seize<T>(
    treasury: &Treasury,
    _: &Auth<SeizePermission, T>,
    mut request: Request<ClawbackFunds<Balance<T>>>,
    policy: &Policy<Balance<T>>,
    to: &Account,
) {
    treasury.assert_mint_redeem_enabled<T>();   // ← blocks regulatory recovery on operational pause
    treasury.assert_can_receive<T>(to.owner());
```

---

#### H-2 — Zero Move unit or integration tests ship with the PR

- **Files:** `sources/**/*_tests.move` — does not exist. `find sources -name "*_tests.move"` → empty.
- **Agreement:** Reviewer 5 (baseline 5/5).
- **Description.** The PR introduces five new Move modules and significant changes to two existing ones (`treasury.move`, `supply.move`). None of these — nor any prior Hadron code — carry automated Move tests. The integration includes:
  - Whitelist state machine with three transition paths (`add`, `remove`, `set_send`, `set_receive`).
  - Mint/Burn/Seize flows with two different witnesses and clawback resolution.
  - Permissionless `approve_transfer` autoresolve.
  - `is_pas_coin` guard on the non-PAS supply path.
  - PolicyCap storage (though unused — see H-5).
- **Impact.** (a) Reviewers cannot verify claimed invariants. (b) Regressions cannot be detected. (c) Audit cost is 2-3× because auditors must re-derive coverage manually.
- **Recommendation.** Minimum baseline to add before audit:
  - `pas_admin::register_pas_asset` — happy path, duplicate, non-zero `total_supply` abort.
  - `treasury::add_to_whitelist` / `remove_from_whitelist` / `set_whitelist_send` / `set_whitelist_receive` — happy paths and error cases (`EAlreadyWhitelisted`, `ENotInWhitelist`).
  - `pas_supply::mint` / `burn` / `seize` — happy path, non-whitelisted abort, paused abort, zero-amount abort.
  - `pas_transfer::approve_transfer` — both-whitelisted → approve; sender-not-whitelisted abort; recipient-not-whitelisted abort; paused abort; zero-amount abort; stale version abort.
  - `supply::{mint,redeem}` — PAS coin abort with `EPasCoinNotAllowed`.
  - `treasury::assert_can_send` / `assert_can_receive` — correct error.
- Use the `/move-tests` skill to scaffold. Target ≥80% branch coverage on the PAS paths.

---

#### H-3 — `Move.toml` pins `pas` + `ptb` dependencies to `rev = "main"` — non-reproducible build

- **Files:** `Move.toml:7-8`
- **Agreement:** Reviewer 3 (all five baseline reviewers also flagged).
- **Description.** The PAS integration's correctness hinges on upstream PAS semantics: `policy::new_for_currency` signature, `clawback_allowed` flag, `request::resolve` strict-equality on approvals, `unlock_funds` default behaviour, `templates::set_template_command` permit requirements. All of these could shift upstream between audit sign-off and deploy, silently.
- **Impact.** Audit-vs-deploy drift; an adversary who notices a favourable upstream change can coordinate a deploy to land vulnerable code. Reviewers + auditors verify against a rev different from what ships.
- **Recommendation.**
```toml
# Move.toml
pas = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/pas", rev = "b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc" }
ptb = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/ptb", rev = "b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc" }
```
Document the pinning strategy in the README. Bump only after re-running audit against the new upstream HEAD. Consider vendoring or mirroring to an org-controlled tag.
- **Evidence.**
```toml
# Move.toml:7-8
pas = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/pas", rev = "main" }
ptb = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/ptb", rev = "main" }
```

---

#### H-4 — `deployAndRegisterPasAsset` uses substring matching + string concatenation to reconstruct `coinType`

- **Files:** `scripts/src/operations/pas.ts:70-91`
- **Agreement:** Reviewer 4.
- **Description.** The deploy helper extracts Sui framework objects by substring matching:
```ts
if (t.includes('::coin::TreasuryCap<')) treasuryCapObjectId = obj.objectId;
else if (t.includes('::coin_registry::MetadataCap<')) metadataCapObjectId = obj.objectId;
else if (t.includes('::coin_registry::Currency<')) currencyObjectId = obj.objectId;
```
Then it reconstructs the coin type:
```ts
const otw = tokenValues.symbol.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
const coinType = `${coinPackageId}::${symbol}::${otw}`;
```
- **Failure modes.**
  - Any framework rename of `::coin::TreasuryCap` or `::coin_registry::MetadataCap` (e.g. under a new framework version or a subdir reshuffle) silently mismatches.
  - The OTW struct name is *assumed* to equal the uppercased symbol — but `token_template_pas/sources/token_template.move:13` hardcodes `TOKEN_TEMPLATE`. Unless `patchConstants` (from the sibling `deployTokenTemplate/patchConstants.ts`) rewrites the OTW identifier in the bytecode (not just the string constants), the reconstructed `coinType` is wrong.
  - Downstream calls (`pas_admin::register_pas_asset`) then abort on-chain with a type-mismatch error that's hard to debug from the deploy logs.
- **Recommendation.**
  1. Match against full framework type strings with explicit `0x2::coin::TreasuryCap<...>` (no substring).
  2. Derive `coinType` from the SDK's `TreasuryCap`/`Currency` type argument, not by string-reconstruction.
  3. Verify (and gate with a test) that `patchConstants` rewrites the OTW struct identifier in the bytecode.
  4. Add a localnet E2E test running `deployAndRegisterPasAsset` with a symbol containing lowercase letters, digits, and non-letter characters; assert that the resulting `coinType` matches on-chain.
- **Evidence.**
```ts
// scripts/src/operations/pas.ts:76-91
for (const obj of createdObjects) {
    if (obj.outputState === 'PackageWrite') {
        coinPackageId = obj.objectId;
        continue;
    }
    const t = objectTypes[obj.objectId] ?? '';
    if (t.includes('::coin::TreasuryCap<')) treasuryCapObjectId = obj.objectId;
    else if (t.includes('::coin_registry::MetadataCap<')) metadataCapObjectId = obj.objectId;
    else if (t.includes('::coin_registry::Currency<')) currencyObjectId = obj.objectId;
}

if (!treasuryCapObjectId || !metadataCapObjectId || !coinPackageId || !currencyObjectId) {
    throw new Error(...);
}

const symbol = tokenValues.symbol.toLowerCase();
const otw = tokenValues.symbol.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
const coinType = `${coinPackageId}::${symbol}::${otw}`;
```

---

#### H-5 — PolicyCap stored but never actionable — PAS policy is effectively frozen after registration

- **Files:** `sources/pas_admin.move:62-67`, `sources/treasury.move:272-275`
- **Agreement:** Reviewer 2.
- **Description.** `pas_admin::register_pas_asset` invokes `policy::new_for_currency`, sets two required approvals on the policy, and deposits the returned `PolicyCap<Balance<T>>` into the Treasury via `add_pas_coin_caps`:
```move
// sources/treasury.move:256
dynamic_object_field::add(&mut treasury.id, keys::policy_cap_key<T>(), policy_cap);
```
A `public(package) fun policy_cap<T>(treasury: &Treasury): &PolicyCap<Balance<T>>` accessor exists (`treasury.move:272`) but is never called from any module in the package. Consequence: after registration, the Hadron code cannot:
  - call `policy::set_required_approval` (add/modify required witnesses),
  - call `policy::remove_action_approval` (e.g. disable clawback-approval requirement temporarily),
  - call `policy::sync_versioning` (after a PAS upstream version block).
The only way to change the policy is a full Hadron package upgrade to add the wrapper function. For incident response, this is the wrong shape.
- **Impact.**
  - If PAS upstream blocks Hadron's policy version (emergency), recovery requires either (a) calling the permissionless `policy::sync_versioning` directly by any party (fine, but no Hadron audit trail), or (b) a Hadron package upgrade. There is no third option.
  - If Hadron needs to add a second approval witness (e.g. a sanctions-list check), a package upgrade is required.
  - The stored PolicyCap occupies storage but delivers no capability the package can exercise — a code smell that auditors will flag.
- **Recommendation.** Add three public functions in `pas_admin`:
```move
public fun update_policy_approval<T, W: drop>(
    treasury: &Treasury,
    auth: &TreasuryAuth<RegisterCoinPermission>,
    policy: &mut Policy<Balance<T>>,
    action: String,
    version: &Version,
);

public fun remove_policy_approval<T>(
    treasury: &Treasury,
    auth: &TreasuryAuth<RegisterCoinPermission>,
    policy: &mut Policy<Balance<T>>,
    action: String,
    version: &Version,
);

public fun sync_policy_versioning<T>(
    treasury: &Treasury,
    policy: &mut Policy<Balance<T>>,
    namespace: &Namespace,
    version: &Version,
);
```
Gate under `TreasuryAuth<RegisterCoinPermission>` or introduce a dedicated `ManagePolicyPermission`. The `sync_policy_versioning` can be permissionless (matches PAS upstream). Add events for each.

---

#### H-6 — `BYTECODE_HEX` constant has no regeneration path and no CI check

- **Files:** `scripts/src/deployPasTokenTemplate/getBytecode.ts:3-8`
- **Agreement:** Reviewer 4.
- **Description.** The TypeScript deploy pipeline ships a single 1.5KB hex constant as the compiled output of `token_template_pas/sources/token_template.move`. The file contains no source → hex regeneration script, no build step in `package.json`, and no CI verification that the hex matches a fresh `sui move build`. Anyone editing `token_template.move` must remember to regenerate the hex by hand; any divergence ships a PAS token whose on-chain module differs from what the source says.
- **Impact.** Silent bytecode drift. Deploys could publish a coin with different OTW struct, different decimals, missing `init_treasury` logic, etc., without source-level indication. For an institutional PAS token this is a financial-grade defect.
- **Recommendation.**
  1. Add `pnpm build:pas-token-template` that runs `sui move build --dump-bytecode-as-base64 token_template_pas` and emits the hex into a generated TS file.
  2. Add a CI check that runs this command and diffs against the committed file; fail if differ.
  3. Or, preferably, publish `token_template_pas` as part of the regular deploy pipeline and reference the published package, not a WASM-patched template.
- **Evidence.**
```ts
// scripts/src/deployPasTokenTemplate/getBytecode.ts:3-8
const BYTECODE_HEX =
    "a11ceb0b060000000a01000c020c1e032a2604500805585a07b201e30108…"; // 1.5KB opaque

export function getBytecode(): Uint8Array {
    return fromHex(BYTECODE_HEX);
}
```

---

### MEDIUM

#### M-1 — `pas_supply::{mint,burn,seize}` do not assert `is_pas_coin<T>`

- **Files:** `sources/pas_supply.move:39-51, 55-72, 76-93`
- The symmetric guard exists in `supply::{mint,redeem}` (`supply.move:35, 51`) preventing PAS coins from taking the non-PAS path. The inverse is missing. A caller with `MintPermission` for a non-PAS coin T could invoke `pas_supply::mint`: `treasury_cap_mut<T>` borrows fine (T is a coin), `account.deposit_balance(balance)` succeeds (no type binding on Account), and non-PAS tokens end up inside a PAS Account. No direct loss, but the closed-loop invariant is broken: non-PAS balance sitting in a PAS Account is recoverable via `unlock_funds::resolve_unrestricted_balance` (since no Policy exists for the non-PAS type), which is actually correct upstream behaviour — but the flow is confusing and PAS events would be fired for a non-PAS asset.
- **Recommendation.** Prepend to each of `pas_supply::mint`, `pas_supply::burn`, `pas_supply::seize`:
```move
assert!(treasury.is_pas_coin<T>(), ENotPasCoin);
```

#### M-2 — `update_transfer_template<T>` does not verify T is a PAS coin

- **Files:** `sources/pas_admin.move:113-121`
- A caller with `RegisterCoinPermission` can register a template for any T. No Hadron Policy exists, so the template would point at `pas_transfer::approve_transfer<T>` which would abort on first use. No fund loss; `Templates` gets polluted with inert entries, and indexers see bogus `TemplateUpdated` events if that's added later.
- **Recommendation.** Add `assert!(treasury.is_pas_coin<T>(), ENotPasCoin);` at the top.

#### M-3 — `can_send` / `can_receive` / `is_whitelisted` abort on non-PAS coin with framework error

- **Files:** `sources/treasury.move:287-302`
- These are public read-only getters. For a non-PAS coin T they do `dynamic_object_field::borrow(whitelist_key<T>)` which aborts inside the Sui framework. Off-chain callers expecting a boolean get a generic abort; the error is not `ENotPasCoin`.
- **Recommendation.** Guard each with `if (!is_pas_coin<T>(treasury)) return false;`. Keep `assert_can_send` / `assert_can_receive` aborts (intentional).

#### M-4 — `add_to_whitelist` forces `can_send=true, can_receive=true` — partial whitelist is two-tx

- **Files:** `sources/treasury.move:315-322`
- Any partial-privilege address (receive-only airdrop recipient, send-only market-maker egress) requires `add_to_whitelist` then `set_whitelist_send(addr, false)` or `set_whitelist_receive(addr, false)` as a second transaction. Between the two there is a live window where the address has full privileges. Small but real.
- **Recommendation.** Replace with `add_to_whitelist<T>(treasury, addr, can_send: bool, can_receive: bool)` or expose both signatures.

#### M-5 — `EMintRedeemPaused` in `pas_transfer` is misleadingly named AND duplicated across modules

- **Files:** `sources/pas_transfer.move:17-19, 44`; `sources/treasury.move:32`
- Two `EMintRedeemPaused` constants exist with different byte strings. The one in `pas_transfer` fires on a *transfer* attempt — user sees "mint and redeem operations are paused" which is incorrect. Also paired with H-1: once the pause flag is split, the error must follow.
- **Recommendation.** Rename the `pas_transfer` constant to `ETransferPaused` (and split the flag per H-1). Centralize shared error constants to `treasury.move` where possible.

#### M-6 — `unlock_funds_action` is intentionally unregistered — load-bearing and undocumented

- **Files:** `sources/pas_admin.move:49-57` + PAS upstream `unlock_funds.move:45, 54`
- The closed-loop invariant for Hadron PAS assets (no user-initiated unlock) depends on PAS upstream aborting on two paths:
  - `unlock_funds::resolve_unrestricted_balance` aborts via `ECannotResolveManagedAssets` because `policy_exists<Balance<T>>()` is true.
  - `unlock_funds::resolve(req, policy)` aborts inside `policy.required_approvals(unlock_funds_action())` with `ENotSupportedAction` because Hadron never registered approvals for that action.
- In both cases the abort happens before the `Request` is consumed. The `Request` hot-potato has no `drop`, so the abort propagates. Move atomicity rolls back the prior `withdraw_balance` from the PAS Account. **No loss of funds** — the previously claimed critical is rejected.
- However: (a) the user sees PAS's abort, not a Hadron error — opaque UX; (b) if PAS upstream ever changes the `ENotSupportedAction` default (e.g. auto-approve when no requirement set), the invariant silently breaks; (c) no docstring tells a future maintainer this omission is deliberate.
- **Recommendation.** Either:
  - (a) Document in `register_pas_asset`'s docstring that the omission of `unlock_funds_action` is a load-bearing design decision and any future add of an unlock approval must go through a full review, **or**
  - (b) Register a Hadron-private `NoUnlockApproval<T>` witness type for `unlock_funds_action` — construct-only from a function that always aborts — so user attempts produce a Hadron-specific abort. Preferred.

#### M-7 — PAS events omit `treasury_id`, `policy_id`, coin-type string

- **Files:** `sources/events.move:89-131` (payload definitions), `sources/events.move:205-238` (emit helpers)
- PAS events carry only `phantom T` and wallet addresses. Multi-institution deployments (multiple Treasuries, multiple PAS assets each) cannot be reliably correlated off-chain. Indexers currently must join at the tx level, which is brittle.
- **Recommendation.** Add `treasury_id: ID` to every PAS event. Optionally include `policy_id: ID` for cross-ecosystem correlation with PAS's own events.

#### M-8 — `register_transfer_template` + `update_transfer_template` emit no event

- **Files:** `sources/pas_admin.move:111-151`
- Templates are mutable post-registration and drive the SDK autoresolve path. Changes should be auditable.
- **Recommendation.** Emit `TemplateUpdated<T> { treasury_id, target_module, target_function }` on each call.

#### M-9 — PAS policy re-deploy migration path is undefined

- **Files:** `sources/pas_admin.move:127-151` (template registration), implicit elsewhere
- `register_transfer_template` uses `type_name::with_defining_ids<TransferApproval<T>>().address_string()` — the defining package ID. This is correct for *upgrades* (defining ID is upgrade-stable). But for a *re-deploy* (new package, new defining ID for the new `TransferApproval<T>`), the old templates in `Templates` remain as orphans keyed on the old type's `TypeName`. The SDK autoresolve uses `TypeName` as the lookup key, so after a re-deploy the new `TransferApproval<T>` has no template → autoresolve fails. Someone must also unset the old orphan for cleanup.
- **Recommendation.** Document the re-deploy migration: for each registered PAS coin call `templates::unset_template_command` with the old permit, then `update_transfer_template` against the new defining-id. Better: expose a `pas_admin::cleanup_templates` helper that does both in one PTB.

#### M-10 — `Auth<P, T>` is coin-scoped but not treasury-scoped; security relies on OTW uniqueness

- **Files:** `sources/auth.move:23-25`; used throughout PAS modules
- `Auth<P, T> { addr }` has no `treasury_id`. The assumption is that coin type T is OTW-unique, so `T` pins down a specific treasury implicitly. Across the whole PR this is structurally sound (only one Treasury can register a given T, enforced at `treasury::add_coin_caps` / `add_pas_coin_caps`). BUT: if a future refactor splits the whitelist state into a second shared object or introduces a second Namespace, the scoping would silently weaken. Defense-in-depth warrants a treasury-id binding in `Auth`.
- **Recommendation.** Add `treasury_id: ID` to `Auth<P, T>` (mirror `TreasuryAuth<P>`'s structure) and assert in every PAS entrypoint that `auth.treasury_id == treasury.treasury_id()`. One-time invariant hardening, zero runtime cost.

#### M-11 — `registerPasAsset` TS helper has no client-side coin-type validation

- **Files:** `scripts/src/operations/pas.ts:13-46`
- `coinType: string` flows directly into `typeArguments` of `tx.moveCall`. Malformed input is caught only on-chain → gas + failed tx.
- **Recommendation.** Pre-flight: split on `::`, assert three non-empty parts; optionally query the Sui coin registry to confirm the `Currency<T>` exists.

#### M-12 — PASClient bound at module load with `NETWORK` and `as any` cast

- **Files:** `scripts/src/operations/pas.ts:11`
- `const pasClient = new PASClient({ suiClient: getClient(NETWORK) as any });` runs at import time. Problems: (a) multi-network workflows impossible, (b) test isolation broken, (c) `as any` defeats type checking between Sui SDK and PAS SDK.
- **Recommendation.** Lazy-construct inside each operation function; properly type the `SuiClient` so the cast is unnecessary (or use a typed adapter if PAS SDK has an older SuiClient type).

#### M-13 — `full-setup.ts` calls `addToWhitelist` sequentially, ignoring individual failure

- **Files:** `scripts/src/examples/full-setup.ts:87-88`
- Two `await addToWhitelist(...)` calls; each returns `void` after `console.log`. If the first fails, the second proceeds against a half-configured state.
- **Recommendation.** Either wrap both whitelist additions in one PTB (atomic), or surface tx digests and check.

#### M-14 — `token_template_pas/Move.toml` has empty `[dependencies]`

- **Files:** `token_template_pas/Move.toml:5-6`
- Relies on implicit framework resolution. Non-standard; any toolchain that doesn't auto-resolve will fail silently.
- **Recommendation.** Declare `Sui` and `MoveStdlib` dependencies explicitly, matching top-level `Move.toml`.

#### M-15 — `WhitelistManagePermission` holder can atomically self-whitelist, send, and un-whitelist in one PTB

- **Files:** `sources/treasury.move:315-360` + `sources/pas_transfer.move`
- A single PTB can call: `add_to_whitelist(self)` → (build transfer) → `approve_transfer` → `remove_from_whitelist(self)`. The whitelist manager is effectively granted "self-send" privilege for free. Not a new vulnerability (a maker with `WhitelistManagePermission` is trusted by construction), but the partner/auditor should explicitly understand that `WhitelistManagePermission` is strictly more privileged than it appears — it de facto subsumes `MintPermission`'s destination-side control.
- **Recommendation.** Either: (a) document this as an intentional privilege model; (b) split `WhitelistManagePermission` into `WhitelistAddPermission` + `WhitelistRemovePermission` per the Notion spec — split gives a weak mitigation (still trivial to bypass via a two-role holder, but makes multi-sig role separation meaningful).

---

### LOW

1. **L-1** — `pas_transfer::transfer_approval_permit` is `public(package)` but only called from `pas_admin`. Can be tightened to private with a friend; better still, move template registration into `pas_transfer` so the permit stays module-local. `sources/pas_transfer.move:54-56`.
2. **L-2** — `pas_supply::burn` / `seize` accept a `&Policy<Balance<T>>` without asserting `object::id(policy) == <treasury-stored policy id>`. Structurally unique per PAS namespace so no exploit, but defense-in-depth is cheap. `sources/pas_supply.move:58, 81`.
3. **L-3** — `WhitelistEntry has copy, drop, store` — `copy` unused. Drop it. `sources/treasury.move:234-237`.
4. **L-4** — `PolicyCapKey<phantom T>`, `WhitelistKey<phantom T>`, `MintRedeemPausedKey<phantom T>` declare `copy` unnecessarily. `sources/keys.move:22, 25, 28`.
5. **L-5** — Doc comment `"DOF key for Table<address, bool>"` is stale — actual is `Table<address, WhitelistEntry>`. `sources/keys.move:27`.
6. **L-6** — `register_transfer_template` uses `with_defining_ids` intentionally; document this in a comment. `sources/pas_admin.move:127-151`.
7. **L-7** — `Move.toml` uses `edition = "2024.beta"`. Consider bumping to `edition = "2024"` (the stable edition). `Move.toml:4`.
8. **L-8** — `mintPasTokens` TS helper accepts `amount: number`; u64 exceeds JS safe integer (2^53-1). Switch to `bigint | string`. `scripts/src/operations/pas.ts:205-210`.
9. **L-9** — `full-setup.ts` decodes a signer key via `new Ed25519PublicKey(fromBase64(pk1B64).slice(1))` — assumes Ed25519 1-byte flag prefix. Use `decodeSuiPrivateKey` helpers. `scripts/src/examples/full-setup.ts:86`.
10. **L-10** — `deployAndRegisterPasAsset` throws a plain Error on ID-extraction failure without the tx digest. Include `deployResult.digest` for debuggability. `scripts/src/operations/pas.ts:81-87`.
11. **L-11** — Both `token_template` and `token_template_pas` declare `module 0x0::token_template`. Rename the PAS one to `0x0::token_template_pas` to avoid any cross-deployment collision. `token_template_pas/sources/token_template.move:1`.

---

### INFO

1. **I-1** — No loss-of-funds path via PAS `unlock_balance` despite the permissionless API. Verified against PAS upstream `unlock_funds.move:45, 54` + `request.move:45-52` + Move atomicity. The previously-imagined critical (user self-unlocks PAS balance) aborts before `Request` consumption, rolling back the prior `withdraw_balance`. Balance preserved.
2. **I-2** — `pas_supply::mint`'s `Account` is trusted to belong to the PAS Namespace. The PAS Namespace is a singleton (enforced by PAS's `init` being unique and `Account::create` using `derived_object`). Structurally safe.
3. **I-3** — Spec drift: Notion PAS Modules spec lists `WhitelistAddPermission` + `WhitelistRemovePermission`; code unifies to `WhitelistManagePermission`. See M-15 for security angle. Update the spec or split the permission.
4. **I-4** — Spec drift: Hadron Blueprint uses "Abilities"; code uses "Permissions". Doc-only harmonization.
5. **I-5** — The Treasury shared object is the serialization point for every PAS mint and every PAS transfer of a given institution. For high-throughput deployments, this is the contention bottleneck. For a permissioned institutional asset this is usually fine; if the partner expects retail-scale concurrent transfers, plan around it.

---

## Integration-boundary verification

Every Hadron → PAS call was cross-checked against `pas@b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc` at `/Users/alilloig/workspace/pas`.

| Call site | Upstream | Verdict |
|---|---|---|
| `policy::new_for_currency(ns, &mut cap, true)` | `policy.move:46-68` | ✅ signature matches |
| `policy.set_required_approval<_, TransferApproval<T>>(cap, send_funds_action())` | `policy.move:80-90` | ✅ witness `drop` ok |
| `policy.set_required_approval<_, ClawbackApproval<T>>(cap, clawback_funds_action())` | same | ✅ |
| `policy.share()` | `policy.move:70-72` | ✅ |
| `templates::set_template_command(..., permit, cmd)` | `templates.move:30-41` | ✅ permit produced in defining module |
| `clawback_funds::resolve(req, policy)` | `clawback_funds.move:28-35` | ✅ `is_clawback_allowed()` is true |
| `send_funds::resolve_balance(req, policy)` | `send_funds.move:62-71` | Called by SDK. Hadron supplies witness. ✅ |
| `account.deposit_balance(balance)` | `account.move:140-143` | ✅ takes `&Account` |
| `request::resolve` | `request.move:45-52` | strict-equality; Hadron's single-witness-per-action compat |
| `unlock_funds::resolve_unrestricted_balance` (user path) | `unlock_funds.move:41-50` | ✅ aborts (`ECannotResolveManagedAssets`) — atomicity preserves balance |
| `unlock_funds::resolve` (user path) | `unlock_funds.move:54-60` | ✅ aborts (`ENotSupportedAction`) — atomicity preserves balance |
| `ptb::move_call(pkg, module, fn, args, ty_args)` | `ptb.move:303-322` | ✅ defining-ID-based |

---

## Coverage matrix

| File | R1 core | R2 state | R3 PAS | R4 TS | R5 tests/adv | Consolidator |
|---|---|---|---|---|---|---|
| `sources/pas_admin.move` | ✓ | · | ✓ | · | ✓ | ✓ |
| `sources/pas_supply.move` | ✓ | · | ✓ | · | · | ✓ |
| `sources/pas_transfer.move` | ✓ | · | ✓ | · | ✓ | ✓ |
| `sources/treasury.move` | ✓ | ✓ | · | · | ✓ | ✓ |
| `sources/permissions.move` | ✓ | · | · | · | ✓ | ✓ |
| `sources/supply.move` | ✓ | · | · | · | ✓ | ✓ |
| `sources/keys.move` | · | ✓ | · | · | · | ✓ |
| `sources/events.move` | · | ✓ | · | · | · | ✓ |
| `Move.toml` / `Move.lock` | · | · | ✓ | · | · | ✓ |
| `token_template_pas/*` | · | · | · | ✓ | ✓ | ✓ |
| `scripts/src/operations/pas.ts` | · | · | · | ✓ | · | ✓ |
| `scripts/src/deployPasTokenTemplate/*` | · | · | · | ✓ | · | ✓ |
| `scripts/src/examples/full-setup.ts` | · | · | · | ✓ | ✓ | ✓ |

Every in-scope file received at least two lenses; every Move file in the PR received at least three. Consolidator verified all HIGH and MEDIUM findings against the code directly.

---

## Methodology

**Posture.** Audit-readiness review. Output is a ticket-attachable Markdown document intended to be circulated alongside the PR for reviewer + auditor + partner consumption.

**Approach.** Single-session, structured five-lens review with a consolidation pass. Each lens applied a distinct mental model to the whole PR:

1. **Move core (R1):** access control, permission/witness design, compliance flags, error conventions.
2. **Treasury / storage (R2):** DOF layout, key types, events, roles integration.
3. **PAS boundary (R3):** every Hadron → PAS call verified against upstream at the pinned `Move.lock` rev.
4. **TypeScript / deploy (R4):** operations, bytecode pipeline, example orchestration.
5. **Tests, docs, adversarial (R5):** coverage, spec drift, attacker scenarios, Move 2024 conformance.

Consolidator (same session) merged findings into clusters, adjudicated severity, and drafted this document. Raw per-reviewer artifacts live at `raw/reviewer-{1..5}-*.md` next to this file; consolidation notes at `raw/consolidation-notes.md`.

**Upstream verification.** PAS upstream used as read-only reference at `/Users/alilloig/workspace/pas` @ `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc` — this matches the commit recorded in `Move.lock` but *not* the floating `rev = "main"` declared in `Move.toml` (see H-3). All upstream semantics quoted above were verified by direct read of the PAS sources.

**Adversarial path review.** R5 considered and explicitly rejected the "user self-unlocks PAS balance" critical scenario that appeared in the previous baseline review. See I-1 — the abort atomicity argument holds; no loss of funds is reachable today. BUT the invariant is load-bearing on PAS upstream behaviour (see M-6) and deserves explicit documentation.

**Comparison with prior review.** A prior review at `reviews/SOLENG-653-pas-integration-review.md` exists and was consulted for calibration (not copied). This review aligns on all four of its HIGH findings (pause flag, tests, rev pin, TS ID-extraction), **elevates** two items (PolicyCap unused → HIGH; bytecode drift → HIGH) based on operational/incident-response impact, and identifies **new** items: M-9 (template re-deploy orphaning), M-10 (Auth treasury-scoping), M-12 (PASClient binding), M-15 (self-whitelist race), L-11 (module name collision).

**Skills / tools.** Direct code reading (Grep + Read), no automated analysis beyond cross-referencing PAS upstream. No test execution (repo has no tests — see H-2). This was intentionally a read-only static review.

**Non-reproducibility caveat.** PAS upstream was read at `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc`. Since `Move.toml` floats on `main`, the actual deploy may see different upstream. Fixing this is H-3.

---

## Artifacts

- `REVIEW.md` — this file.
- `raw/reviewer-1-move-core.md` — Move access control & compliance findings.
- `raw/reviewer-2-treasury-storage.md` — Treasury, keys, events.
- `raw/reviewer-3-pas-integration.md` — PAS upstream boundary.
- `raw/reviewer-4-typescript-deploy.md` — TS, bytecode, scripts.
- `raw/reviewer-5-tests-docs-adversarial.md` — coverage + adversarial scenarios.
- `raw/consolidation-notes.md` — cluster adjudication & severity reconciliation.

---

## Recommended path to merge

**Block merge on H-1, H-2, H-3, H-4, H-5, H-6.** These are all straightforward fixes + one test pass:

1. Split pause flag (H-1) — ~50 lines of Move + 2 new permission types.
2. Pin Move.toml revs (H-3) — one-line change.
3. Fix `Move.toml` rev (H-3) — and document a bump policy.
4. Rework TS ID extraction (H-4) — ~30 lines TS; add one E2E test.
5. Add PolicyCap accessors (H-5) — ~50 lines Move + tests.
6. Add bytecode regeneration script + CI (H-6) — ~20 lines tooling.
7. Write tests (H-2) — ~400 lines Move test scenarios.

After those: address MEDIUM items before mainnet; LOW items can land in follow-up PRs. INFO items feed the runbook / spec documentation pass.

Estimated engineering effort from branch HEAD to audit-ready: 1.5–2 weeks including the test baseline.
