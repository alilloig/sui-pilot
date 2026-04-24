# Consolidator — cluster adjudication

Each finding below is keyed to the five reviewers above. For clusters, the consolidator reconciled severity and merged evidence.

## Clusters

- **K-1 Pause-flag conflation** ← R1-01 (HIGH), R5-04 (MEDIUM, adversarial angle). **Final HIGH.**
- **K-2 Zero tests** ← R5-01 (HIGH). All reviewers implicitly. **Final HIGH.**
- **K-3 `Move.toml rev=main`** ← R3-01 (HIGH). **Final HIGH.**
- **K-4 TS object-ID substring fragility** ← R4-01 (HIGH). **Final HIGH.**
- **K-5 Bytecode drift** ← R4-02 (HIGH). **Final HIGH** — elevated from Low because there is no regeneration path and a silent mismatch ships bad coin.
- **K-6 PolicyCap stored but unused** ← R2-01 (HIGH). **Final HIGH** — policy is effectively frozen post-register.
- **K-7 `pas_supply::{mint,burn,seize}` missing is_pas_coin guard** ← R1-02 (MEDIUM). **Final MEDIUM.**
- **K-8 `update_transfer_template` missing is_pas_coin guard** ← R1-03 (MEDIUM). **Final MEDIUM.**
- **K-9 Whitelist getters abort on non-PAS coin** ← R1-04 (MEDIUM). **Final MEDIUM.**
- **K-10 `add_to_whitelist` forces full privileges** ← R1-05 (MEDIUM). **Final MEDIUM.**
- **K-11 `EMintRedeemPaused` misleading** ← R1-06 (MEDIUM) + R2-09 (LOW duplicate). **Final MEDIUM** (paired with K-1).
- **K-12 Unlock-action intentionally undefined + undocumented** ← R3-02 (MEDIUM), R1-10 (INFO). **Final MEDIUM** (load-bearing; document or enforce).
- **K-13 PAS events lack correlation metadata** ← R2-02 (MEDIUM), R2-03 (MEDIUM), R2-04 (MEDIUM — template events). **Final MEDIUM.**
- **K-14 Package re-deploy orphans templates; no runbook** ← R5-17 (MEDIUM), R3-03 (MEDIUM). **Final MEDIUM.**
- **K-15 TS coin-type + amount validation** ← R4-03 (MEDIUM), R4-04 (MEDIUM). **Final MEDIUM.**
- **K-16 PASClient module-level binding + as-any** ← R4-05 (MEDIUM). **Final MEDIUM.**
- **K-17 Example script swallows failures** ← R4-06 (MEDIUM). **Final MEDIUM.**
- **K-18 token_template_pas Move.toml empty deps** ← R4-07 (MEDIUM). **Final MEDIUM.**
- **K-19 Module-name collision token_template ↔ token_template_pas** ← R4-08 (MEDIUM). **Final MEDIUM.**
- **K-20 No PAS operational runbook (version block, re-deploy)** ← R5-16 (MEDIUM), R5-17 (MEDIUM). **Final MEDIUM** (partly subsumed by K-14).
- **K-21 Whitelist race / self-whitelist privilege inflation** ← R5-05 (MEDIUM). **Final MEDIUM** — document; consider split permission.
- **K-22 defining-ID vs original-ID documentation** ← R3-03 (MEDIUM), R5-17 (MEDIUM). **Final LOW** — doc only.
- **K-23 Policy object-id binding defense-in-depth** ← R1-08 (LOW), R3-06 (LOW). **Final LOW.**
- **K-24 PAS send contract: wallet-vs-account derivation document** ← R3-04 (MEDIUM). **Final LOW** (upstream-contract doc note).
- **K-25 Unused `copy` on `WhitelistEntry`, key structs** ← R2-05 (LOW), R2-06 (LOW), R5-12. **Final LOW.**
- **K-26 Stale doc comment `Table<address,bool>`** ← R2-08 (LOW). **Final LOW.**
- **K-27 Ed25519 key slicing** ← R4-09 (LOW). **Final LOW.**
- **K-28 Error throwing w/o digest** ← R4-10 (LOW). **Final LOW.**
- **K-29 u64 number vs bigint** ← R4-04 (MEDIUM). **Final LOW** — demoted given this is a helper example.
- **K-30 Move.toml edition = 2024.beta** ← R5-09 (LOW). **Final LOW.**
- **K-31 No README quickstart for PAS** ← R5-18 (LOW). **Final LOW.**
- **K-32 `pas_supply` doc missing version-gate comment** ← R5-08 (LOW/INFO). **Final LOW/INFO.**
- **K-33 pas_transfer::transfer_approval_permit visibility** ← R1-09 (LOW). **Final LOW.**
- **K-34 Unlock closed-loop preserved by atomicity** ← R5-02 (REJECTED as CRITICAL, preserved as INFO). **Final INFO.**
- **K-35 `sync_versioning` not exposed** ← R3-05 (LOW). **Final INFO**.
- **K-36 Treasury shared-object contention** ← R2-11 (INFO). **Final INFO.**
- **K-37 Spec drift: WhitelistManagePermission vs Add/Remove** ← R5-06 (INFO). **Final INFO.**
- **K-38 Spec drift: Abilities vs Permissions terminology** ← R5-07 (INFO). **Final INFO.**

## Severity totals (final)

- CRITICAL: 0
- HIGH: 6 (K-1..K-6)
- MEDIUM: 15 (K-7..K-21)
- LOW: 11 (K-22..K-33, minus K-29 which is dual-count)
- INFO: 5 (K-34..K-38)

## Comparison to previous baseline review (`reviews/SOLENG-653-pas-integration-review.md`)

New review aligns on:
- H-1 pause-flag → our K-1 (same issue).
- H-2 no tests → our K-2.
- H-3 Move.toml rev=main → our K-3.
- H-4 TS ID-extraction → our K-4.

Delta vs baseline:
- Baseline rated `M-2 PolicyCap unreachable` as MEDIUM; we elevate to HIGH (K-6) because the policy is genuinely mutation-locked and the workaround (package upgrade) is expensive and slow in incident response.
- Baseline rated `M-10 bytecode drift` as MEDIUM (upgraded from Low); we elevate further to HIGH (K-5) because the failure mode is a silently-shipped wrong coin; financial-grade deploys shouldn't accept this.
- Baseline's remaining M/L/I items are broadly covered by our K-7..K-38.
- No new CRITICALs identified (consistent with baseline).

Final verdict: **Approve with changes** — identical posture to baseline. No critical findings. 6 HIGH findings to block merge on.
