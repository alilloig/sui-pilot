# Verification Notes — Consolidator Adjudication Log

Adjudications for every cluster meeting verification criteria: `max_severity ∈ {critical, high}`, `disputed_severity = true`, `agreement_count = 1 AND max_severity ≥ high`, or `source_ids > 4`.

Upstream snapshot used for integration-boundary checks: `/Users/alilloig/workspace/pas` @ `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc`.

---

## C022 — set_whitelist_send/receive mega-cluster  (max_sev: critical → split)

**Source IDs:** R5-005 (low, correctness observation), R5-006 (critical, self-retracted false positive).

**Verdict: SPLIT + REJECT R5-006 + confirm R5-005 at info.**

**Code re-read (treasury.move L335–360).**

```move
public(package) fun set_whitelist_send<T>(
    treasury: &mut Treasury,
    addr: address,
    enabled: bool,
) {
    let wl: &mut Table<address, WhitelistEntry> = dynamic_object_field::borrow_mut(
        &mut treasury.id,
        keys::whitelist_key<T>(),
    );
    assert!(wl.contains(addr), ENotInWhitelist);
    wl[addr].can_send = enabled;  // ← writes to can_send. CORRECT.
}

public(package) fun set_whitelist_receive<T>(
    treasury: &mut Treasury,
    addr: address,
    enabled: bool,
) {
    let wl: &mut Table<address, WhitelistEntry> = dynamic_object_field::borrow_mut(
        &mut treasury.id,
        keys::whitelist_key<T>(),
    );
    assert!(wl.contains(addr), ENotInWhitelist);
    wl[addr].can_receive = enabled;  // ← writes to can_receive. CORRECT.
}
```

Both functions write to the correct field. R5-006 was the reviewer self-retracting a suspected swap bug after re-read; evidence quoted includes `wl[addr].can_send = enabled;` correctly.

**Adversary path.** None — no bug.

**Final severity:** R5-006 REJECTED (false positive, correctly retracted by reviewer). R5-005 KEPT at info (atomicity observation is valid but not actionable — Move's single-threaded transaction model guarantees check-then-set atomicity).

**Cluster outcome:** Split; C022a = R5-005 (info, atomicity observation, treasury.move); C022b = REJECTED (no action).

---

## C007 — Move.toml pins PAS deps to branch `main`  (max_sev: high, agreement: 3/5 — R1, R3, R5)

**Verdict: CONFIRM at high.**

**Code re-read (Move.toml L7–8).**

```
[dependencies]
pas = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/pas", rev = "main" }
ptb = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/ptb", rev = "main" }
```

`Move.lock` snapshots the resolved SHA (`b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc`), so lockfile-respecting builds reproduce today. But `rev = "main"` in the manifest means:
- Any CI/build that skips or regenerates the lockfile pulls current upstream main.
- Audit reviewers reading `Move.toml` cannot verify the reviewed code without the lockfile alongside.
- Upstream changes to policy semantics, request resolution, or template storage would silently ship.

**Adversary path (why high, not medium).** Not an on-chain adversary, but a supply-chain-drift risk. If a partner publishes from a fresh checkout without the lockfile (happens in some CI), the upstream version can silently change. Tightening the pin is cheap and customary for audit-ready code.

**Final severity:** high. **Final title:** "Move.toml pins PAS git deps to branch name (`main`) — non-reproducible build".

---

## C028 — approve_transfer permissionless — mega-cluster  (max_sev: high, agreement: 3/5)

**Source IDs:** R2-001 (high — permissionless, single enforcement point), R2-005 (info — witness drop-only observation), R3-003 (medium — test all negation cases), R5-002 (info — adversarial walkthrough), R5-004 (info — adversarial forged-Treasury walkthrough).

**Verdict: SPLIT. Downgrade R2-001 from high to medium; keep R3-003 as medium (merge with R2-001); surface R2-005, R5-002, R5-004 as info-level audit annotations.**

**Code re-read (pas_transfer.move L33–50).**

```move
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
    events::emit_pas_transfer_approved<T>(sender, recipient, amount);
}
```

**Adversary path.** I cannot construct a compliance bypass.
- The `Request<SendFunds<Balance<T>>>` hot potato can only be constructed by `pas::account::send_balance<C>` (upstream `account.move` L78) or `unsafe_send_balance` (L108). Both require `&Auth` for the source account; the upstream `send_funds::new` populates sender/recipient from verified on-chain context.
- Supplying a wrong `&Treasury` fails because `TreasuryCap<T>` is unique per OTW per package; T is bound to exactly one treasury.
- Double-approving the request aborts upstream in `VecSet.insert`.

The permissionless nature is by-PAS-design (autoresolve pattern) and is the correct architectural choice for scale. The downgrade rationale: no bypass path exists; the finding is "test all four negation cases exhaustively" plus "document the single-point-of-compliance posture", which maps to medium (test gap + documentation) rather than high.

**Final severity:** medium (merged). Final title: "approve_transfer is the sole whitelist enforcement point — missing exhaustive negative-path tests".

**Cluster outcome:** C028 splits into:
- C028a (medium): single-enforcement-point testing gap — merges R2-001 + R3-003.
- C028b (info): witness-abilities + adversarial walkthroughs — merges R2-005 + R5-002 + R5-004 (audit documentation).

---

## C027 — approve_transfer couples mint/redeem pause to transfer pause  (max_sev: medium, disputed med/info, 2/5 — R1, R5)

**Verdict: CONFIRM at medium.**

**Code re-read (pas_transfer.move L44).**

```move
assert!(!treasury.is_mint_redeem_paused<T>(), EMintRedeemPaused);
```

There is no separate transfer-pause flag. Pausing mint/redeem also halts secondary transfers of the PAS coin. Spec (Notion "PAS Modules") lists the check as "not paused" without distinguishing what pause means; Hadron Blueprint describes application-layer pause as "Blocks mint + redeem" — transfers are not mentioned. This is spec drift: the code broadens the pause effect beyond what the spec stipulates.

**Impact is operational, not adversarial.** A compliance officer pausing mint for an event unexpectedly halts all token trading. Medium severity is correct.

**Final severity:** medium. **Final title:** "Mint/redeem pause doubles as a transfer pause — spec drift".

---

## Other clusters requiring short adjudication

### C017 — Non-PAS coin whitelist helpers abort opaquely  (medium, 4/5 — R1, R2, R3, R5)

**Verdict: CONFIRM at medium.** Four reviewers independently caught the same gap. The Hadron-defined `ENotPasCoin` exists (treasury.move L67) but is not used in the nine whitelist read/write helpers. Fix is a trivial one-line assertion per helper.

### C009 — register_pas_asset missing is_coin_registered check  (medium, 2/5 — R1, R4)

**Verdict: CONFIRM at medium.** Upstream `policy::new_for_currency` asserts `!namespace.policy_exists<Balance<C>>` (policy.move L47) and Hadron's `add_pas_coin_caps` asserts `!dynamic_object_field::exists_(..., treasury_cap_key<T>())` (treasury.move L248). Both catch duplicate registration, but surface as upstream / inner-function aborts. Adding an early Hadron-owned check improves error UX without changing semantics.

### C010 — No tests for PAS modules  (medium, 2/5 — R1, R5)

**Verdict: CONFIRM at medium.** Three new modules + meaningful additions to treasury.move with zero `#[test]` functions. Critical compliance paths uncovered by automation.

### C013 — Auth<P, T> treasury-binding via implicit OTW uniqueness  (medium, 2/5 — R2, R4)

**Verdict: DOWNGRADE to low.** The treasury-binding-via-phantom-T argument is documented in Hadron Blueprint ("Coin binding via phantom T"). It's correct and load-bearing, but the finding is a documentation request, not a safety gap. Low is sufficient (move-quality / docs-adjacent).

### C019 — add_pas_coin_caps allows cap without policy config  (medium, 2/5 — R2, R3)

**Verdict: DOWNGRADE to low.** The function is `public(package)`. Only `pas_admin::register_pas_asset` calls it today, and that caller always configures the policy before invoking. Future in-package callers would need to replicate the pattern; a module-level comment is sufficient. Low is right.

### C023 — scripts mega-cluster (pas.ts)  (medium, 3 source IDs — R1-004 hardcode 0xc, R1-012 substring ID extraction, R5-014 missing seize/burn helpers)

**Verdict: SPLIT.** Three distinct concerns packed in one cluster by line-range proximity (all in pas.ts).
- **C023a (low):** hardcoded `0xc`/`0x2` registry addresses → R1-004.
- **C023b (medium):** substring-based object-ID extraction → R1-012.
- **C023c (low):** missing seize/burn/setWhitelistSend/Receive TS helpers → R5-014, R5-015.

### C024 — mintPasTokens u64 as JS number  (medium, 2/5 — R1, R5)

**Verdict: CONFIRM at medium.** JS number safe-integer limit is 2^53 - 1; a 6-decimal stablecoin exceeds this at ~9 billion tokens. Not impossible in a test/demo but unlikely in normal institutional amounts. Still, fix is a one-character change (`number` → `bigint`) and blocks a future footgun. Note R5-015 which was on setWhitelistSend/Receive helpers was miscategorized by the clustering (both landed at lines 205–231 proximity).

### C001 — @mysten/pas caret range  (medium, 1/5 — R0)

**Verdict: CONFIRM at medium.** 0.x caret range with a pre-1.0 SDK whose behaviors encode on-chain template derivation. Pin exactly.

### C011 — Template staleness post-upgrade  (medium, 1/5 — R1)

**Verdict: CONFIRM at medium.** Template autoresolve stores a move_call that points to the Hadron package address at registration time. Post-upgrade, the old package address may be version-blocked by `Version::check_is_valid`, halting all transfers until `update_transfer_template<T>` is called for every PAS coin. This is operationally dangerous without a runbook. Singleton-medium survives verification.

### C038 — pas_supply::mint version check  (medium, 1/5 — R4)

**Verdict: DOWNGRADE to low.** The Auth proof for MintPermission is created via `auth::new_auth` which checks `version.check_is_valid()`. Upstream `account::deposit_balance` also checks account versioning. Defense-in-depth redundancy is nice but not medium — low is right.

### C045 — No e2e test of autoresolve transfer  (medium, 1/5 — R4)

**Verdict: CONFIRM at medium.** Template registration is wire-critical. A mistyped module name or package address would silently break transfers. An integration test is the right mitigation.

---

## Summary of adjudication

- **Splits:** C022 (2 findings), C023 (3 findings), C028 (2 findings).
- **Rejections:** R5-006 (self-retracted false positive).
- **Downgrades:** C013 (med → low), C019 (med → low), C038 (med → low).
- **Confirmations at same severity:** C007 (high), C017 (med), C009 (med), C010 (med), C024 (med), C001 (med), C011 (med), C045 (med), C027 (med).
- **No critical findings survive verification.** The one critical-tier cluster (C022) was reviewer self-retracted.

Severity distribution after verification: **0 critical, 1 high, 10 medium, ~19 low, ~17 info** (plus rejected R5-006).
