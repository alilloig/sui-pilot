# Reviewer 4 — TypeScript, Deploy, Bytecode Template

Scope: `scripts/src/operations/pas.ts`, `scripts/src/deployPasTokenTemplate/*`, `scripts/src/examples/full-setup.ts`, `token_template_pas/*`.

## Findings

### R4-01 [HIGH] Object-ID extraction in `deployAndRegisterPasAsset` is substring-based and brittle
- `scripts/src/operations/pas.ts:70-91`
- ```
  if (t.includes('::coin::TreasuryCap<')) treasuryCapObjectId = obj.objectId;
  else if (t.includes('::coin_registry::MetadataCap<')) metadataCapObjectId = obj.objectId;
  ```
- Failure modes:
  - Framework rename of `::coin::TreasuryCap` or `::coin_registry::MetadataCap` silently breaks the script.
  - Multiple matching objects land on "last write wins" (unlikely today, possible if template evolves).
  - `coinType` is reconstructed by string-concatenation: `${coinPackageId}::${symbol}::${otw}` where `otw = tokenValues.symbol.toUpperCase().replace(/[^A-Z0-9_]/g, "_")`. This assumes the OTW struct name equals the uppercased symbol. But `token_template_pas/sources/token_template.move:13` hardcodes `TOKEN_TEMPLATE`. If `patchConstants` does not also rewrite the struct identifier in the bytecode, the reconstructed `coinType` is wrong and all subsequent calls fail with confusing type-mismatch errors.
  - An ill-typed `coinType` passed to `pas_admin::register_pas_asset` aborts on-chain but only after gas is spent.
- Fix:
  1. Use full-type comparison with explicit package ID (`0x2`): `type === '0x2::coin::TreasuryCap<…>'`.
  2. Read `coinType` from the Currency/TreasuryCap's type argument rather than reconstructing.
  3. Verify that `patchConstants` rewrites the OTW struct identifier (not just the string constants). If it only rewrites strings, this flow is already broken for any symbol not exactly `TMPL` renamed to something matching the byte-length and layout constraints of the stored module — confirm with a localnet E2E test.

### R4-02 [HIGH] `BYTECODE_HEX` in `getBytecode.ts` has no build reproducibility path
- `scripts/src/deployPasTokenTemplate/getBytecode.ts:3-8`
- A single opaque hex constant is the serialized compiled output of `token_template_pas/sources/token_template.move`. There is no build script to regenerate it, no CI check that it matches a fresh compile, and no version/hash annotation.
- Failure mode: someone edits the Move source, forgets to regenerate the hex, and deploys proceed with the stale bytecode. Users receive a PAS token whose on-chain structure differs from what the source says.
- Fix: add `pnpm build:token-template` that compiles `token_template_pas` with `sui move build` and emits the hex; add a CI step that asserts the committed hex matches a fresh build.

### R4-03 [MEDIUM] `registerPasAsset(treasuryId, coinType, caps)` does no client-side coin-type validation
- `scripts/src/operations/pas.ts:13-46`
- `coinType` is passed straight into `tx.moveCall` as `typeArguments`. Malformed input ("foo", missing `::`, wrong package) is caught only on-chain — costs gas and one failed tx.
- Fix: split by `::` and assert three non-empty parts; optionally query the on-chain coin registry to confirm existence before building the PTB.

### R4-04 [MEDIUM] `mintPasTokens` accepts `amount: number` — JS number loses precision above 2^53
- `scripts/src/operations/pas.ts:210`
- u64 on-chain accepts values up to 2^64 - 1. JS `number` is safe only up to 2^53 - 1. Mint of `1e18` (a common PAS use-case: 18-decimal token with big nominal) overflows or rounds.
- Fix: accept `bigint | string` and pass via `tx.pure.u64(BigInt(amount))`.

### R4-05 [MEDIUM] `PASClient` constructed at module load with `NETWORK` — implicit global state
- `scripts/src/operations/pas.ts:11`
- `const pasClient = new PASClient({ suiClient: getClient(NETWORK) as any });` runs at module import. Consequences:
  - Cannot test with a different network without re-import.
  - `as any` cast defeats type checking; if `getClient(NETWORK)` returns a newer `SuiClient` incompatible with `PASClient`'s expected type, the failure is at first call, not at import.
  - Multi-network workflows (e.g. testnet + localnet in one process) become impossible.
- Fix: construct `PASClient` inside each operation function and type the `SuiClient` properly.

### R4-06 [MEDIUM] `addToWhitelist` in `full-setup.ts` invocations ignore failures via top-level serialization
- `scripts/src/examples/full-setup.ts:87-88`
- Two consecutive `await addToWhitelist(...)` calls. Each returns `void` after `console.log`. If the first fails silently (e.g. due to object version mismatch), the second proceeds against a partially configured state.
- Fix: surface the digest/effects from `addToWhitelist`; wrap in a single PTB to atomically whitelist both the sender and the receiver.

### R4-07 [MEDIUM] `token_template_pas/Move.toml` has empty `[dependencies]`
- `token_template_pas/Move.toml:5-6`
- Relies on implicit framework discovery (Sui + MoveStdlib pulled via the build's environment). Non-standard; any toolchain that doesn't resolve implicit dependencies will fail.
- Fix: declare `Sui` and `MoveStdlib` explicitly, matching the top-level `Move.toml` dependency patterns.

### R4-08 [MEDIUM] Both `token_template` and `token_template_pas` use module `0x0::token_template`
- `token_template_pas/sources/token_template.move:1`
- Declared `module 0x0::token_template;`. The non-PAS template (at `token_template/sources/token_template.move`) uses the same module name. If both are ever published through the same manifest (unlikely but possible via scripts), the second would collide on publish.
- Fix: rename to `0x0::token_template_pas` (or use a distinct namespace).

### R4-09 [LOW] `full-setup.ts` uses `new Ed25519PublicKey(fromBase64(pk1B64).slice(1))` — assumes a 1-byte key-scheme flag prefix
- `scripts/src/examples/full-setup.ts:86`
- Works for Ed25519 base64 keys exported from Sui CLI (33 bytes, flag 0x00 prefix). Any other key format breaks silently.
- Fix: use the Sui SDK's `decodeSuiPrivateKey` / `fromExportedKeypair` helpers instead of manual slicing.

### R4-10 [LOW] `deployAndRegisterPasAsset` throws a generic Error on ID-extraction failure
- `scripts/src/operations/pas.ts:81-87`
- Good that it throws, but the error carries no tx digest or reason. When this fires, debugging requires re-running with explicit logging.
- Fix: include `deployResult.digest`, dump `createdObjects`, and add a structured error type.

### R4-11 [INFO] `deployAndRegisterPasAsset` bundles "finalize registration + register_pas_asset" into a single PTB — good
- `scripts/src/operations/pas.ts:100-138`
- Atomicity is correct. Documentation should state the design decision; someone may be tempted to split for readability.
