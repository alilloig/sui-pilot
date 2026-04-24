# Verification notes — SOLENG-653 PAS integration (PR #8)

Verdicts for every cluster that met verification criteria (max_sev high, disputed_severity, singleton-high, or source_ids > 4).

---

## C001 — Move.toml pins `pas` and `ptb` to branch `main`  (max_sev: high, agreement: 10/10)

**Verdict: CONFIRM as ops/build concern — routed to Build reproducibility & ops section (NOT a severity-graded code finding per rubric).**

**Code re-read.** `Move.toml` L7-8:
```
pas = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/pas", rev = "main" }
ptb = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/ptb", rev = "main" }
```
`Move.lock` pins `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc` for testnet env. A fresh checkout regenerating the lockfile (e.g. `mainnet` env not yet declared) will silently pull the branch tip.

**Adversary path.** Not a code bug. Supply-chain / reproducibility risk. Anyone with commit access to `MystenLabs/pas:main` can change downstream semantics on the next lockfile regeneration.

**Final severity:** routed to ops (was reported medium-high); no code-finding severity. **Category:** versioning → ops section only.

---

## C003 — No tests for any PAS module  (max_sev: high, agreement: 10/10)

**Verdict: CONFIRM as testing gap — routed to Test & coverage plan section (NOT a severity-graded code finding).**

**Code re-read.** `find sources -name '*.move' | xargs grep -l '#\[test'` yields zero hits in `pas_admin.move`, `pas_supply.move`, `pas_transfer.move`, and the PAS helpers in `treasury.move`. Only phase-1 `create_for_testing` / `share_for_testing` exists.

**Final severity:** test posture only; concrete test scenarios enumerated in Test & coverage plan. Not a code-level severity finding per rubric.

---

## C048 — pas.ts uses substring match + symbol-derived coinType (max_sev: high, agreement: 10/10)

**Verdict: CONFIRM but DOWNGRADE — routed to Build reproducibility & ops (scripts category).**

**Code re-read.** `scripts/src/operations/pas.ts` L70-91:
```ts
if (t.includes('::coin::TreasuryCap<')) treasuryCapObjectId = obj.objectId;
...
const symbol = tokenValues.symbol.toLowerCase();
const otw = tokenValues.symbol.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
const coinType = `${coinPackageId}::${symbol}::${otw}`;
```

Substring match + duplicated OTW-derivation logic. The mismatch between `toLowerCase()` (for module name) and `replace(/[^A-Z0-9_]/g, "_").toLowerCase()` (the OTW-derived module in `patchConstants`) yields a broken `coinType` for any symbol with non-alphanumeric chars.

**Adversary path.** Not a security adversary; deploy-ergonomics break. Funds never at risk — downstream PTB aborts cleanly with type-not-registered.

**Final severity:** ops-section item; the substring-match symptom is LOW (framework rename unlikely), the symbol-derivation duplication is a MEDIUM-priority script fix. Catalogued in Build & ops.

---

## C005 — register_transfer_template uses TransferApproval<T>'s defining-id address — stale post-upgrade  (max_sev: high, agreement: 9/10)

**Verdict: SPLIT into two findings. Confirm core upgrade claim at HIGH (post-upgrade DoS), reject arg-order concern (R3-012 was self-refuted).**

**Code re-read.** `sources/pas_admin.move` L132-145. `type_name::with_defining_ids<TransferApproval<T>>()` resolves to the *defining* package ID (stdlib docs confirmed at `/Users/alilloig/workspace/sui/crates/sui-framework/packages/move-stdlib/sources/type_name.move` L42-45: "defining IDs (the ID of the package in storage that first introduced the type)"). After a hadron package upgrade, `TransferApproval`'s defining ID is still v1. `update_transfer_template` calls `register_transfer_template` again, which re-resolves the same v1 address — no-op.

Meanwhile, `sources/version.move` L18, L32 hard-codes `VERSION = 1` as a compile-time constant. `migrate()` sets the shared `Version.version` to whatever VERSION is in the *calling* package (v2's VERSION=2). Afterward, v1 bytecode's `check_is_valid()` still compares the shared `version` (=2) to v1's baked-in `VERSION=1` → aborts `EInvalidPackageVersion`. Because Sui PTB `move_call` with an immutable package_id dispatches to *that* specific published bytecode, the autoresolve template keyed on v1's address will route to v1's `approve_transfer`, which aborts on version check.

**Adversary path.** No adversary needed; legitimate upgrade breaks every PAS transfer. Admin calls `update_transfer_template<T>` expecting recovery; the no-op re-writes the same v1 address. The only remediation is upstream PAS changing to `with_original_ids`, or a hadron patch that accepts an explicit `package_id` override.

**Final severity:** HIGH. **Final title:** `update_transfer_template is a no-op post-upgrade — autoresolve template permanently routes to v1, which aborts after migrate`.

**Split-off:** R3-012's "arg order mismatch" is self-refuted in its own description ("in that order, which is correct"). REJECT that sub-claim; treat as INFO future-proofing note bundled in Move-quality low.

---

## C029 — ClawbackApproval mega-cluster (max_sev: high, agreement: 9/10)

**Verdict: SPLIT into 6 distinct findings.**

This is a mega-cluster bundling 17 source findings across 4 different concerns. Splits:

### C029-A — pas_supply::burn/seize/mint lack explicit `is_pas_coin<T>()` guard (MEDIUM)
**Code re-read.** `pas_supply.move` L39-93. `mint` calls `treasury.assert_can_receive<T>(...)` which borrows `WhitelistKey<T>` DOF — aborts if T not PAS. `burn` calls `treasury.treasury_cap_mut<T>()` which only asserts `is_coin_registered<T>()`. If T is a regulated (non-PAS) coin, `burn` would reach `request.approve(ClawbackApproval<T>()); clawback_funds::resolve(request, policy)` — but `policy: &Policy<Balance<T>>` is a required parameter, and the upstream PAS `Policy<Balance<T>>` only exists if the PAS namespace has registered T. So `burn` cannot physically execute for non-PAS coins (caller must produce a `Policy<Balance<T>>` object which won't exist). However, `seize` has the same defense. So the claim "can burn a regulated coin" is wrong — **impossible to produce the Policy input**. But the opaque-abort concern is real: on accidental misuse, diagnostic is poor. Adversary path: none. **Severity: LOW** (defensive hardening).

### C029-B — `pas_supply::seize` gated by mint/redeem pause — DoS compliance during incidents (MEDIUM)
**Code re-read.** `pas_supply.move` L83: `treasury.assert_mint_redeem_enabled<T>()`. Design conflation: pausing mint/redeem also locks the compliance team out of seize. Per spec §7.2, seize MUST work while paused to extract funds from de-whitelisted addresses during incidents. **Severity: MEDIUM** (legitimate regression of compliance posture). Only R1 flagged; under-reported.

### C029-C — pas_supply entrypoints skip explicit `version.check_is_valid` (LOW)
**Code re-read.** `pas_supply::mint/burn/seize` rely on `Auth<_, T>` created via `auth::new_auth` which checks version at creation. `pas_transfer::approve_transfer` explicitly re-checks version (auth-less entrypoint). Inconsistency but not exploitable — Auth has `drop` and is scoped to the PTB. Confirm as **LOW** (documentation / consistency polish).

### C029-D — `pas_supply::mint` permits whitelist of object-owned Account addresses without docs (LOW/INFO)
**Code re-read.** PAS `account::owner()` returns a wallet or `object::id(account).to_address()`. Operators whitelisting must know which flavor applies. Doc omission. **Severity: INFO**.

### C029-E — Seize does not verify source is whitelisted — intentional per spec (INFO)
**Verdict: no bug — spec-aligned.** Emit as INFO documentation note.

### C029-F — ClawbackApproval is public struct, not permit-gated (LOW)
**Code re-read.** `pas_supply.move` L33: `public struct ClawbackApproval<phantom T>() has drop;`. Constructor is only usable from the defining module (Move visibility rules). The `public` keyword here affects the type, not the constructor. So cross-module forgery is impossible. The R10-029 concern is mostly theoretical. In contrast, `TransferApproval` uses the same pattern but its permit is exposed via `transfer_approval_permit<T>()`. **Severity: LOW** (style consistency with TransferApproval). REJECT the "any caller can forge" framing.

### Split-off (testing) — covered by C003.
Test findings bundled in this cluster (R3-014, R5-010, R6-010, R7-008, R8-009) route to Test & coverage plan.

---

## C006 — update_transfer_template lets any institution overwrite another's template  (max_sev: high, agreement: 8/10)

**Verdict: SPLIT. Confirm cross-institution overwrite as HIGH. Downgrade whitelist-mutator-non-PAS to LOW (opaque-abort only).**

**Code re-read.** `pas_admin.move` L113-121:
```move
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
`TreasuryAuth<RegisterCoinPermission>` is scoped to the *caller's* treasury. T is unbounded. `Templates` is a shared singleton (upstream `templates.move` L23-27). `set_template_command<A>` is keyed by `type_name::with_defining_ids<TransferApproval<T>>()` — globally per T, not per treasury.

**Adversary path.** Adversary = any operator in institution B with `RegisterCoinPermission` on B's treasury. They call `update_transfer_template<FooInA>(B_treasury, B_auth, templates, version)`. `assert_is_valid_for_treasury` passes (auth matches B). `register_transfer_template<FooInA>` writes into the shared Templates a command that dispatches `hadron::pas_transfer::approve_transfer<FooInA>(B_treasury, request, version)`. Future autoresolve transfers for `FooInA` (owned by institution A) will now run against B's treasury — which has no `WhitelistKey<FooInA>` DOF — and abort inside `assert_can_send<FooInA>`. Cross-institution DoS.

Gain: grief / DoS another institution's PAS transfers. No value extraction. Severity: HIGH.

**Final severity:** HIGH. **Final title:** `update_transfer_template<T> allows any institution to overwrite any other institution's autoresolve template (cross-institution DoS)`.

**Split-off — whitelist mutator non-PAS check (R1-009, R2-005, R3-004, R4-004, R9-005):** Auth gates on `is_coin_registered<T>()` but not `is_pas_coin<T>()`. Non-PAS coins fail inside `dynamic_object_field::borrow` with opaque abort. Since `TreasuryCap<T>` is unique and can only be registered in one treasury, cross-treasury attack is not physically possible. The claim "any holder of WhitelistManagePermission can mutate whitelist of any treasury" (R8-002 HIGH) is refuted: `new_auth<P,T>` requires `is_coin_registered<T>()` in the treasury passed, and only the treasury holding `TreasuryCap<T>` can satisfy that. **DOWNGRADE to LOW — opaque-abort ergonomics only.**

**Split-off — namespace-binding (R5-027):** Namespace is a singleton per deployment (upstream `namespace.move` L24). Only one Namespace exists; no mismatch possible. **REJECT.**

---

## C053 — deployPasTokenTemplate passes only 0x1 and 0x2 as deps  (max_sev: high, agreement: 7/10)

**Verdict: REJECT the "missing 0xc" framing. DOWNGRADE to INFO.**

**Code re-read.** `deployPasTokenTemplate.ts` L21-24. Deps `0x1` (move-stdlib) and `0x2` (sui-framework) are passed. The template uses `sui::coin_registry::new_currency_with_otw` which lives at `0x2::coin_registry` — covered by `0x2`. `0xc` is a shared OBJECT id (CoinRegistry object), not a package. `tx.object('0xc')` is a runtime object reference, not a declared publish dep. Thus no additional package dep is needed.

**Adversary path.** None.

**Final severity:** INFO. Move to ops-section note that deps appear correct; the R5-016 text itself acknowledges "so covered by 0x2".

---

## C042 — No tests for pas_transfer whitelist / pause / version logic  (max_sev: high, agreement: 2/10)

**Verdict: CONFIRM as testing gap — merged into Test & coverage plan.**

Same as C003.

---

## C038 — Mint/redeem pause also disables PAS transfers  (max_sev: medium, agreement: 10/10)

**Verdict: CONFIRM as MEDIUM — design-intent ambiguity; spec did not explicitly scope transfer pause.**

**Code re-read.** `pas_transfer.move` L44: `assert!(!treasury.is_mint_redeem_paused<T>(), EMintRedeemPaused);`. The error constant is re-used from the mint context; naming ambiguity. Spec §7.2 does not explicitly state that transfer pause is controlled by the mint/redeem flag. Two plausible operational stances: (a) conflate (current code) — simple, one switch; (b) separate transfer-pause flag for granular control.

**Final severity:** MEDIUM — design-intent clarification needed, plus rename error message to reflect transfer context.

---

## C047 — pas.ts uses JS number for u64 amount (max_sev: medium, agreement: 10/10)

**Verdict: CONFIRM as MEDIUM — silent precision loss for amounts > 2^53.**

**Code re-read.** `pas.ts` L209 `amount: number` and L229 pass as raw u64 arg. JS numbers lose precision above `2^53 - 1` ≈ 9.0 × 10^15. For a 6-decimal PAS coin, that's about 9 billion whole units — potentially reachable for institutional bond issuance.

**Final severity:** MEDIUM (scripts concern → routed to ops section).

---

## C007 — register_pas_asset lacks `is_pas_coin` early guard  (max_sev: medium, agreement: 9/10)

**Verdict: CONFIRM as LOW — opaque-abort ergonomics only.**

**Code re-read.** `pas_admin::register_pas_asset` L30-67. Upstream `policy::new_for_currency` L51 asserts `!namespace.policy_exists<Balance<C>>()` — double-register aborts there. Additionally, `add_pas_coin_caps` L249 asserts `!dynamic_object_field::exists_(treasury_cap_key<T>)` — locally aborts. So double-registration is prevented, just with an opaque upstream abort when hitting the namespace-policy check first.

**Final severity:** LOW (already covered by two defensive layers; improvement is ergonomic).

---

## C018 — treasury whitelist helpers abort opaquely for non-PAS coins (max_sev: medium, agreement: 9/10)

**Verdict: CONFIRM as LOW — opaque-abort ergonomics; no correctness issue.**

**Code re-read.** `treasury.move` L278-332. All whitelist helpers directly `dynamic_object_field::borrow(whitelist_key<T>)`. If T is not PAS-registered, the DOF doesn't exist and the borrow aborts with `dynamic_object_field` internal code rather than the well-defined `ENotPasCoin`. Easy to fix; not exploitable.

**Final severity:** LOW.

---

## C052 — bytecode hex hardcoded without regen script (max_sev: medium, agreement: 9/10)

**Verdict: CONFIRM — ops-section concern (build reproducibility).**

**Final severity:** routed to Build & ops.

---

## C049 — pkg() returns '' on missing deploy output (max_sev: medium, agreement: 8/10)

**Verdict: CONFIRM — ops-section script concern.**

---

## C041 — approve_transfer validates wallet sender/recipient but balance goes to account_id (max_sev: medium, agreement: 5/10)

**Verdict: CONFIRM at MEDIUM (design acceptance noted) — upstream-intended pattern; document.**

**Code re-read.** `pas_transfer.move` L33-50 checks wallet addresses; upstream `send_funds::resolve_balance` L67-71 forwards to `recipient_account_id.to_address()`. Per upstream `send_funds.move` comment L22-28, recipients are always "wallet OR object address, NOT the account address" at the Request level, and resolve routes to the derived recipient_account_id. Since accounts are derived from owner via `derived_object::claim(namespace, keys::account_key(owner))`, the owner↔account_id relationship is 1:1 per namespace. Validating the wallet is sufficient IF the namespace mapping is trusted. The namespace itself is a singleton, so this works.

**Final severity:** MEDIUM — document the invariant in module header; not a bug.

---

## C045 — WhitelistManagePermission collapses four spec permissions (max_sev: low, agreement: 10/10)

**Verdict: CONFIRM INFO — spec drift flagged in context §7.2; intentional design choice by implementer.**

**Final severity:** INFO.

---

## Summary of rejected / downgraded claims

- R3-012 "template arg-order mismatch" — self-refuted by reviewer; REJECT.
- R8-002 "whitelist mutator cross-treasury abuse" — DOWNGRADE to LOW (TreasuryCap<T> uniqueness prevents the claimed path).
- R5-027 "namespace mismatch" — REJECT (PAS namespace is singleton).
- R4-018 / R5-016 / C053 "missing 0xc dep" — DOWNGRADE to INFO (0xc is an object, not a package; 0x2 covers coin_registry module).
- R10-029 "ClawbackApproval public struct forgery" — REJECT constructor-visibility framing; keep as LOW style-consistency note.
- R6-003 "burn destroys without consent" — DOWNGRADE to MEDIUM design note (clawback is upstream-intended admin flow; matches spec §7.2 burn semantics).

## Summary of upgraded / highlighted claims

- C006 cross-institution template overwrite — **HIGH** (confirmed adversary path, only 1/10 reviewers — R6 — framed it crisply).
- C005/R6-001 post-upgrade autoresolve DoS — **HIGH** (confirmed via type_name stdlib semantics + version constant behaviour).
- C029-B seize-pause conflation — MEDIUM (only 1/10 caught it; meaningful compliance regression).
