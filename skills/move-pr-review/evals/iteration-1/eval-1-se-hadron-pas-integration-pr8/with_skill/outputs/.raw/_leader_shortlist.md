# Leader shortlist — orchestrator pre-read (PRIVATE)

Not shared with consolidator. Used by orchestrator to sanity-check reviewer convergence.

## Top risks the orchestrator identified before fan-out

1. **Move.toml `rev = "main"`** — HIGH audit-reproducibility risk. Expected all reviewers to catch. (Caught by R1, R3, R5 — 3/5.)
2. **Whitelist helpers missing `is_pas_coin` pre-check** — MEDIUM opaque-abort. Expected multiple reviewers. (Caught by R1, R2, R3, R5 — 4/5.)
3. **`register_pas_asset` missing `is_coin_registered` pre-check** — MEDIUM; opaque upstream abort. (Caught by R1, R4 — 2/5.)
4. **No tests** — MEDIUM. Expected all reviewers. (Caught by R1, R3, R4, R5 — 4/5.)
5. **`approve_transfer` permissionless** — Not a bug; needed documentation in R2, R3, R5 — worth flagging to consolidator.
6. **`EMintRedeemPaused` error message reused for transfers** — LOW; only R3 caught.
7. **u64 precision (JS number for amount)** — MEDIUM. Only R1 caught.
8. **Single WhitelistManagePermission vs spec's add+remove split** — INFO; spec drift. Only R1 caught.
9. **Template staleness after upgrade** — MEDIUM. Only R1 caught.
10. **Edition `2024.beta`** — LOW. R2 and R5 caught.
11. **R5-006 false positive** — R5 filed a CRITICAL bug on `set_whitelist_send` writing to `can_receive`, then retracted in the description. Must be REJECTED during consolidation. Test of verification pass.

## Coverage near-misses I expect

- `sources/events.move` — only R1, R3, R5 touched. Should get 3+ touches. OK.
- `sources/keys.move` — only R3 touched. Under-covered, but it's a trivial file. OK.
- `token_template_pas/sources/token_template.move` — R1 touched; R5 peripherally. Under-covered. R0 backfill NOT required (low-risk file).
- `scripts/src/deployPasTokenTemplate/getBytecode.ts` — no reviewer touched. Under-covered but it's a static bytecode hex constant. R0 backfill candidate.
- `scripts/src/operations/index.ts` — no reviewer touched. R0 backfill candidate (trivial re-export; INFO only).
- `token_template_pas/Move.toml` — no reviewer directly touched. R0 backfill candidate.

## Counter-signals to watch

- All 5 reviewers should catch the `rev = "main"` issue. Only 3 did (R1, R3, R5). R2 and R4 missed it — this is a blind-spot risk. The orchestrator's backfill will not add it (already well-represented), but consolidator should upgrade confidence.
- R2's permissionless-approve_transfer framing (R2-001) is useful perspective that others missed.
- R3's `EMintRedeemPaused` error-message-mismatch (R3-004) is unique.
- R1's template-staleness-post-upgrade (R1-007) is unique and operationally important.
- R5 surfaced one false-positive critical (R5-006) — verification pass must reject it.
