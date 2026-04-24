# PAS Integration Review — Shared Context Bundle (SOLENG-653)

> Read this completely before reviewing. Single source of truth for all 5 reviewers. Consolidator uses it to normalize findings.

## 1. Ticket

- **Linear ticket:** [SOLENG-653 — Hadron phase 2: Move consultation](https://linear.app/mysten-labs/issue/SOLENG-653/hadron-phase-2-move-consultation)
- **Created by:** Nikos Petridis. **Assignee:** Yannis Chatzianagnostou. **Status:** In Progress.
- **Ask:** Move consultation on the partner-delivered Hadron phase-2 PR that introduces the PAS (Programmable Asset Standard) integration. Phase-1 code (pre-existing) is NOT in scope — it is under separate audit. Review the PAS-specific additions and the diffs they imply in existing modules (supply guard, treasury PAS caps).

## 2. PR under review

- **Repo:** `MystenLabs/se-hadron`
- **PR:** [`#8` — feat: add PAS asset integration with whitelist-based compliance](https://github.com/MystenLabs/se-hadron/pull/8)
- **Author:** `chariskms` (Haris Katimertzis)
- **Base:** `main`  **Head:** `feat/pas-integration`
- **HEAD commit:** `e72f685a3f9265bf3ea12a68a6aba86675bb3537`
- **Diff size:** +1000 / −14 lines over 21 files. Single commit.

## 3. Dep pins (reproducibility)

`Move.toml` declares:

```
pas = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/pas", rev = "main" }
ptb = { git = "git@github.com:MystenLabs/pas.git", subdir = "packages/ptb", rev = "main" }
```

- ⚠️ **Both `rev` values are the branch name `main`** (not a commit SHA). This is non-reproducible and surfaces as a finding in the final report.
- `Move.lock` pins (testnet env) to `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc` for both `pas` and `ptb`.
- Local clone at `/Users/alilloig/workspace/pas` currently HEAD `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc` — matches lockfile. Reviewers MUST treat this as the upstream snapshot.

## 4. Review scope — IN

Each reviewer MUST touch every file in this list at least once.

**New Move modules (audit fully):**
- `sources/pas_admin.move` — 151 lines
- `sources/pas_supply.move` — 93 lines
- `sources/pas_transfer.move` — 56 lines

**Modified Move modules (audit the diff, not the whole file):**
- `sources/permissions.move` — added `WhitelistManagePermission`, `SeizePermission`
- `sources/treasury.move` — added PAS caps storage, whitelist table, per-address entries, `add_pas_coin_caps`, `is_pas_coin`, `policy_cap`, `is_whitelisted/can_send/can_receive/assert_can_*`, `add/remove_from_whitelist`, `set_whitelist_send/receive`, error codes
- `sources/supply.move` — added `EPasCoinNotAllowed` guard in `mint` and `redeem` against PAS coins
- `sources/events.move` — added `PasAssetRegistered`, `WhitelistAdded`, `WhitelistRemoved`, `PasTransferApproved`, `PasMinted`, `PasBurned`, `PasSeized`, `WhitelistSendUpdated`, `WhitelistReceiveUpdated` + emitters
- `sources/keys.move` — added `PolicyCapKey<T>`, `WhitelistKey<T>` + constructors

**New Move package:**
- `token_template_pas/Move.toml`, `token_template_pas/Move.lock`, `token_template_pas/sources/token_template.move` — non-regulated coin template used to deploy PAS assets.

**Off-chain code (audit fully):**
- `scripts/src/operations/pas.ts` — register/whitelist/mint for PAS assets
- `scripts/src/deployPasTokenTemplate/deployPasTokenTemplate.ts` — WASM bytecode patch + publish
- `scripts/src/deployPasTokenTemplate/getBytecode.ts` — hard-coded bytecode
- `scripts/src/deployPasTokenTemplate/index.ts` — re-export
- `scripts/src/examples/full-setup.ts` — end-to-end PAS flow
- `scripts/src/operations/index.ts` — re-exports

**Configuration / manifest:**
- `Move.toml` — `pas` and `ptb` git deps
- `scripts/package.json` — `@mysten/pas` dependency
- `scripts/src/constants.ts` — added `whitelistManage`, `seize` permission type constants

## 5. Review scope — OUT (read for context only)

DO NOT file findings on these files. They are pre-existing phase-1 code, under a separate audit.

- `sources/admin.move`, `sources/auth.move`, `sources/compliance.move`, `sources/metadata.move`, `sources/multisig_addr.move`, `sources/namespace.move`, `sources/pk_util.move`, `sources/roles.move`, `sources/version.move`
- `scripts/src/deploy/*`, `scripts/src/deployTokenTemplate/*`, `scripts/src/operations/{treasury,roles,coin,supply,compliance,metadata}.ts`, `scripts/src/utils.ts`, etc.
- `token_template/*`

You MAY read these files to understand integration boundaries but do not emit findings against them.

## 6. Upstream dep surface to cross-check

Upstream snapshot: `/Users/alilloig/workspace/pas` @ `b64f0c58c60888de99ad9c5a72e9f0289aa7b6fc` (matches lockfile).

| Hadron call-site | Upstream symbol | Upstream file (read-only) |
|---|---|---|
| `pas_admin::register_pas_asset` | `pas::policy::new_for_currency<C>(namespace, &mut TreasuryCap<C>, bool)` | `/Users/alilloig/workspace/pas/packages/pas/sources/policy.move` L47–68 |
| `pas_admin::register_pas_asset` | `pas::policy::set_required_approval<T, A>(&mut Policy<T>, &PolicyCap<T>, String)` | `policy.move` L81–92 |
| `pas_admin::register_pas_asset` | `pas::policy::share` | `policy.move` L70–72 |
| `pas_admin::register_transfer_template` | `ptb::ptb::move_call(...)` | `/Users/alilloig/workspace/pas/packages/ptb/sources/*` |
| `pas_admin::register_transfer_template` | `pas::templates::set_template_command<A>(&mut Templates, internal::Permit<A>, Command)` | `/Users/alilloig/workspace/pas/packages/pas/sources/templates.move` L30–40 |
| `pas_admin::register_transfer_template` | `pas::templates::PAS` marker | `templates.move` L15 |
| `pas_admin` uses `pas::keys::send_funds_action()` / `clawback_funds_action()` | returns `String` literals `"send_funds"`, `"clawback_funds"` | `/Users/alilloig/workspace/pas/packages/pas/sources/keys.move` |
| `pas_supply::mint` | `pas::account::Account::owner()`, `deposit_balance<C>()` | `/Users/alilloig/workspace/pas/packages/pas/sources/account.move` L126, L129 |
| `pas_supply::burn` | `pas::request::Request::data()`, `::approve<K, U>()`; `pas::clawback_funds::ClawbackFunds::owner()/funds()`, `resolve<T>(Request, &Policy<T>) -> T` | `request.move`, `clawback_funds.move` |
| `pas_supply::seize` | Same `clawback_funds::resolve` path; `account::deposit_balance<C>` | same |
| `pas_transfer::approve_transfer` | `pas::request::Request<SendFunds<Balance<T>>>::data()`, `::approve<K,U>()`; `pas::send_funds::SendFunds::sender()/recipient()/funds()` | `request.move` L22–30, `send_funds.move` L30–43 |
| `pas_transfer::transfer_approval_permit` | `internal::permit<A>()` (implicit namespace — not `pas::internal`) | — |

### Key semantics to validate

1. `send_funds::resolve_balance<C>` (upstream) sends funds to the **recipient_account_id**, not the wallet address. Hadron's `approve_transfer` validates the **wallet `sender` and `recipient`**, not the account IDs. This is the intended pattern per upstream doc but be adversarial about the mismatch.
2. `clawback_funds::resolve` aborts if `policy.is_clawback_allowed()` is false. Hadron's `register_pas_asset` passes `true` — consistent.
3. `policy::new_for_currency` asserts `!namespace.policy_exists<Balance<C>>()` — only one policy per coin type. If a PAS registration attempt finds the policy exists, it aborts.
4. `Request::approve` uses `VecSet.insert` — duplicate approvals abort.
5. `account.deposit_balance` forwards balance to the **object::id(account)**, not `account.owner`. This is how PAS accounts hold funds.
6. `pas::templates::setup` is an `entry fun` called once at namespace setup (by an operator); Hadron does not create the Templates object.

## 7. Design intent (distilled from Notion)

### 7.1 "Hadron Blueprint" (Notion)

- Multi-institution, multi-coin treasury management; each institution = one shared derived Treasury.
- Two proof types: `Auth<A, T>` (coin-scoped) and `TreasuryAuth<A>` (treasury-scoped). Both check `version.check_is_valid()` at creation.
- Abilities (in spec, renamed to "Permissions" in code) — functions gate on abilities, roles are groupings. `ManageRolesPermission` coverage is tracked so unassign cannot drop below 1.
- Two pause layers: application (`PauseMintRedeemPermission`) and protocol (`GlobalPausePermission` via `DenyCapV2`).
- Multisig from genesis — bootstrap admin must be a native multisig.
- Events are phantom-`T` parameterized for coin-scoped facts.

### 7.2 "PAS Modules" (Notion)

- `pas_admin::register_pas_asset<T>` — creates PAS Policy (clawback enabled), sets `TransferApproval` / `ClawbackApproval` required approvals, registers autoresolve template, stores caps + whitelist.
- `pas_admin::add_to_whitelist<T>` — spec says **`Auth<WhitelistAddPermission, T>`** (spec drift — code uses `Auth<WhitelistManagePermission, T>` for both add and remove).
- `pas_admin::remove_from_whitelist<T>` — spec says **`Auth<WhitelistRemovePermission, T>`**; code: `WhitelistManagePermission`. **Spec drift — flag as info/low.**
- `pas_admin::set_whitelist_send<T>` / `set_whitelist_receive<T>` — spec says `Auth<WhitelistAddPermission, T>`; code: `WhitelistManagePermission`.
- `pas_admin::update_transfer_template<T>` — spec says `TreasuryAuth<RegisterCoinPermission>`; matches code.
- `pas_supply::mint<T>` — spec says checks: `amount > 0`, mint not paused, recipient is whitelisted. Code matches.
- `pas_supply::burn<T>` — spec says checks: not paused, `amount > 0`. Code matches.
- `pas_supply::seize<T>` — spec says checks: not paused, destination whitelisted, `amount > 0`. Code matches; but spec does not require source to be whitelisted (designed so seize can extract funds from de-whitelisted addresses).
- `pas_transfer::approve_transfer<T>` — permissionless autoresolve entrypoint. Validates `version`, `amount > 0`, not paused, sender can send, recipient can receive.

> **Spec drift note:** the single `WhitelistManagePermission` (code) replaces two separate `WhitelistAddPermission` / `WhitelistRemovePermission` (spec). Surface as info-level, not blocking.

## 8. Finding schema (strict)

See `${CLAUDE_PLUGIN_ROOT}/skills/move-pr-review/references/finding_schema.md`. Summarized here:

JSON array per reviewer. Each element:

```json
{
  "id": "R<N>-NNN",
  "title": "<=80 chars",
  "severity": "critical|high|medium|low|info",
  "category": "access-control|correctness|arithmetic|object-model|versioning|integration-boundary|events|move-quality|testing|scripts|docs",
  "file": "sources/xxx.move",
  "line_range": "N" | "N-M",
  "description": "...",
  "impact": "...",
  "recommendation": "...",
  "evidence": "<literal code quote, >=1 full line>",
  "confidence": "high|medium|low"
}
```

- `id` prefix MUST match reviewer number (`R1-001` for reviewer 1, `R0-*` for leader backfill).
- `evidence` is a literal copy-paste, not a paraphrase.
- Integration-boundary findings quote the upstream file path in `evidence`.

## 9. Severity rubric

| Level | Use when |
|---|---|
| **critical** | Loss of funds, bypass of compliance / authorization controls, broken authorization boundary, lost upgrade path. Adversary path must be concretely writable. |
| **high** | Incorrect behaviour on the golden path, missing check that enables misuse, state corruption under legitimate call sequences. |
| **medium** | Correctness ambiguity, missing event/error, unsafe default, fragile dependency on upstream behaviour, test gaps for critical paths, operational issues. |
| **low** | Style / idiom drift from Move 2024, redundant abilities, naming inconsistencies, non-essential test gaps, code-quality polish. |
| **info** | Observations, doc suggestions, follow-ups not blocking merge, design notes. |

## 10. LEADS — confirm / refute / ignore (DO NOT TRUST)

Orchestrator pre-read suspicions. Independently confirm or refute; they are **not findings**.

1. `pas_admin::register_pas_asset` does not check `treasury.is_pas_coin<T>()` before `policy::new_for_currency`. A second registration attempt would abort inside the PAS `policy::new_for_currency` (policy-exists), but the local error surface is opaque. Consider an explicit early abort.
2. `pas_admin` whitelist mutators use `Auth<WhitelistManagePermission, T>` which (per `auth::new_auth`) asserts `treasury.is_coin_registered<T>()` — but NOT `is_pas_coin<T>()`. In principle, a non-PAS coin registered via `admin::register_coin` would let you mint a `WhitelistManagePermission` auth and attempt `add_to_whitelist<T>` — which would then abort deep inside `dynamic_object_field::borrow_mut` because the whitelist DOF was never created. Surface as a low/medium ergonomics issue (opaque abort rather than a clean error).
3. `pas_supply::burn` constructs the `ClawbackApproval<T>()` witness directly — but the PAS Policy required_approvals keys by `type_name::with_defining_ids<T>()`. Confirm the type name of `ClawbackApproval<T>` here matches `pas_admin::register_pas_asset` registration. Should be identical since they use the same type.
4. `pas_transfer::approve_transfer` checks `!is_mint_redeem_paused<T>` to gate transfers. This is a design choice — pausing mint/redeem also pauses transfers. Spec allows this but confirm it is intended; if a treasurer wants to pause only mint/redeem and not transfers, this conflates.
5. `treasury::remove_from_whitelist<T>` removes an address outright but does NOT clear any in-flight state. It only matters if there's held state per address — check the table structure (just `WhitelistEntry`, so OK).
6. `WhitelistEntry` stores `can_send`, `can_receive` as booleans. No timestamps, no rate limits. Spec does not require them but surface as info if relevant.
7. `pas_admin::update_transfer_template` takes `&Treasury` (immutable), not `&mut`. It only re-registers the template command, which writes to `templates: &mut Templates`. OK.
8. `pas_admin::register_transfer_template` uses `approval_type.address_string()` from `TransferApproval<T>`. This resolves to the **Hadron package address** — correct for pointing back to `hadron::pas_transfer`. But if Hadron is upgraded, the address changes and the template becomes stale. `update_transfer_template` exists to fix this; surface the upgrade hazard as info/low.
9. `pas_supply::seize` checks `to.owner()` is whitelisted (receiver) but does NOT check source is whitelisted — deliberate per spec (seize extracts from de-whitelisted). OK.
10. `pas_supply::mint` guards with `treasury.assert_can_receive<T>(account.owner())`. If the account owner is a `UID`-owned account (object ownership), `owner()` is a synthetic address from `uid.to_inner().to_address()`. Whitelisting object accounts requires knowing that address. Surface as info/docs.
11. `supply::mint` and `supply::redeem` both now assert `!treasury.is_pas_coin<T>()`. Good. This correctly funnels PAS coins through `pas_supply`. But an already-minted regulated coin would not convert to a PAS coin; the guard is for safety on registration collision. Low risk.
12. The token_template_pas module uses `module 0x0::token_template;` — same OTW name as `token_template/` used for regulated coins. Each deployment creates its own package, so per-OTW uniqueness is per-package. OK.
13. `pas_admin::register_pas_asset` has the parameter list `(treasury, auth, treasury_cap, metadata_cap, pas_namespace, templates, version, ctx)` — but `version: &Version` is only used transitively via `register_transfer_template` (which calls nothing on version). The main fn does NOT itself call `version.check_is_valid()`. Surface: is the version check at auth creation sufficient? The function is called only after auth is built, so yes. Still, `update_transfer_template` also relies on auth-side version check. OK.
14. `scripts/src/examples/full-setup.ts` stores the mint recipient as `accountId` (a PAS account ID). The on-chain `pas_supply::mint` takes `&Account` — call-site passes the account ID via `tx.object()`. Confirm the account actually exists when mint runs — the script creates accounts before mint. OK.
15. `scripts/src/operations/pas.ts` uses `pkg()` function which may fall back to `''` if deploy data missing; no guard. Surface as script robustness low.
16. `deployPasTokenTemplate.ts` hard-codes `0x1` and `0x2` as deps but no `0xa`/`0xc` (coin registry). Confirm whether registry dep is implicit via the bytecode. Inspect bytecode hex string.
17. `pas_transfer::approve_transfer` takes `request: &mut Request<...>`, not ownership. Upstream `request::approve` takes `&mut` — matches. OK.
18. No tests for any new module (`#[test]` functions absent). Surface as medium testing finding.
19. `ETreasuryCapNotEmpty` is asserted in `add_pas_coin_caps`. Good — prevents registering a previously-minted cap.
20. `pas_admin::register_pas_asset` does NOT require the `MetadataCap` total supply / registration state. The caller trust comes from `treasury_cap.total_supply() == 0`. OK.

## 11. Working directory & prohibitions

- **cwd:** `/Users/alilloig/workspace/se-hadron`. Upstream dep at `/Users/alilloig/workspace/pas` (READ-ONLY).
- **Workspace (where artifacts go):** `/tmp/move-pr-review-workspace/iteration-1/se-hadron-pas-integration-pr8/with_skill/outputs/` — this is the "reviews/" equivalent. Raw artifacts go in `outputs/.raw/`.
- **NO** edits to Move / TS code, manifests, or anywhere outside the workspace.
- **NO** `sui move build`, `forge`, `pnpm install`, `git commit`, `git push`, mutating `gh` commands.
- **DO** read upstream files to validate integration boundaries.

## 12. Budget

- Target ~30–45 minutes per reviewer.
- Target 10–30 findings each. Quality > quantity.
