# Sui / Move / Walrus / Seal — Relational Knowledge Graph

> Master reference for the Sui ecosystem. Maps every concept-stable building block —
> Move language constructs, Sui runtime primitives, the off-chain stack (Walrus, Seal,
> TS SDK) — how they relate, when each is the right tool, and which bundled skills
> provide deeper guidance.
>
> ⤳ skill: move-code-quality — Move-2024 syntax/idiom enforcement
> ⤳ skill: move-code-review — security, architecture, design review
> ⤳ skill: move-pr-review — multi-agent deep PR review
> ⤳ skill: move-tests — unit-test generation
> ⤳ skill: oz-math — OpenZeppelin math integration audit

---

## Legend

- `→ depends on` — runtime, compile-time, or conceptual prerequisite
- `↔ integrates with` — bidirectional collaboration; both sides know about each other
- `⇢ alternative to` — substitutable for the same job (pick one, not both)
- `⊃ contains` — parent/child or whole/part relationship
- `⤳ skill:` — pointer to a bundled skill that provides actionable guidance
- `📖 docs:` — entry point in the bundled corpora (search root: `${CLAUDE_PLUGIN_ROOT}/.<source>-docs/`)

This document is **not always-loaded**. The plugin's hooks select the chunk(s) relevant
to the current task and inject only those. When you receive a section, treat it as the
authoritative concept map for that area; cross-reference other sections by Glob/Grep
when the edges suggest you should.

---

## Move type system & abilities

Move's type system is value-oriented and ability-gated. Every type carries an explicit
set of *abilities* that determines what can be done with values of that type — copied,
dropped (silently destroyed), stored under an account/object, or used as a top-level
on-chain object. Mismatched abilities are a compile-time error, not a runtime check.

```
ABILITIES                             📖 docs: .move-book-docs/book/move-basics/abilities-introduction.md
│
├── copy   — value can be duplicated (`let b = a;` doesn't move)
│   ↔ drop  — usually paired; `copy + drop` ≈ "plain old data"
│   ⇢ alternative: pass by reference (`&T`) when the value is expensive
│
├── drop   — value can be silently dropped at end of scope
│   ↔ Hot-potato pattern → values WITHOUT drop force the caller to consume them
│   ⤳ skill: move-code-review (hot-potato is a load-bearing safety pattern)
│
├── key    — value may be stored as a top-level Sui object (requires UID as first field)
│   → Sui object model § UID/ID
│   ↔ store — `key + store` is the standard "owned object" combo
│   ⊃ marker for `transfer::*` family (transfer/share/freeze/wrap)
│
└── store  — value may be embedded inside another object's fields
    → key   — store-only (no key) types are fields, not standalone objects
    ⇢ alternative: `Option<T>` when the embedded value may be absent
```

**Generics & phantom types**

```
GENERIC TYPES                         📖 docs: .move-book-docs/book/move-basics/generics.md
│
├── Constrained generics: `<T: store + drop>`  → propagate ability requirements
│   → ABILITIES (compile-time check)
│   ⤳ skill: move-code-quality (proper bounds = idiomatic Move 2024)
│
├── Phantom type parameters: `<phantom T>`     → carry brand without storage cost
│   ↔ One-time-witness pattern (§ Authorization patterns)
│   ↔ Coin<T>, Balance<T>, TreasuryCap<T>      → witness-typed currencies
│
└── Witness types (typically zero-sized)       → unforgeable type-level proof
    → § Authorization patterns
```

**References & ownership in Move**

```
REFERENCES                            📖 docs: .move-book-docs/book/move-basics/references.md
│
├── &T   immutable borrow — read-only, multiple coexist
├── &mut T mutable borrow — exclusive, no aliasing
└── Ownership rules
    ├── A function consuming a value by-move destroys the caller's binding
    ├── References cannot outlive their referent — borrow-checker enforced
    └── No `Drop`-equivalent destructor; types lacking `drop` MUST be consumed explicitly
        ⤳ skill: move-code-review (look for unconsumed hot-potatoes & resource leaks)
```

**Move 2024 idioms** that the agent should *prefer over their pre-2024 equivalents*:

- `module x::y;` (file-level form) over `module x::y { ... }`
- Method-call syntax: `v.push_back(x)` over `vector::push_back(&mut v, x)`
- Macros: `vector::do!`, `vector::fold!`, `option::destroy!` over hand-written loops
- Implicit framework dependencies (Sui 1.45+) — drop explicit `Sui = { ... }` from `Move.toml` unless pinning a non-default version
- `assert!(cond, code)` with named error constants — never magic numbers
- `package::Type::method(...)` qualified calls when the receiver is ambiguous

⤳ skill: move-code-quality (the canonical checklist for these)

---

## Modules & visibility

Modules are the unit of code organization, deployment, and visibility in Move.
Visibility ranges from private (default) → `public(package)` (intra-package) →
`public` (cross-package callable). The `friend` keyword from pre-2024 Move is replaced
by `public(package)` for the most common cases.

```
MODULES                               📖 docs: .move-book-docs/book/move-basics/module.md
├── module x::y;                      → file-level, Move 2024
├── public(package) fun ...           → callable only from same package
├── public fun ...                    → callable from any package (entry points + library API)
├── entry fun ...                     → callable as a transaction's top-level call
└── #[allow(...)] / #[test_only]      → attribute-driven scope
    ⤳ skill: move-code-quality
```

Stub — flesh out further when chunk-extraction tests start asking for this section.

---

## Sui object model

Sui's runtime is object-centric, not account-centric. Every long-lived value lives
inside an *object* with a globally-unique `UID`, an *ownership* mode, and a *version*.
The right ownership mode is the single most consequential design choice in any Sui
package — it determines parallelizability, who can mutate the object, and whether
consensus is required.

```
SUI OBJECT MODEL                      📖 docs: .sui-docs/develop/objects/index.mdx
│
├── UID (globally unique, 32-byte) — required first field of any `key`-able struct
│   → Move type system § ABILITIES (key requires UID)
│   ↔ object::new(ctx)               → construct fresh UID (consumes a counter)
│   ↔ object::delete(uid)            → destroy when wrapping/unwrapping
│
├── Object ownership                  📖 docs: .sui-docs/develop/objects/object-ownership/
│   ├── Address-owned                 ⤳ skill: move-code-review
│   │   → fast-path execution; one writer at a time; no consensus needed
│   │   ⇢ alternative: shared (when multi-writer is required)
│   │
│   ├── Shared                        → consensus-required; multi-writer; congestion-prone
│   │   ⤳ skill: move-code-review (look for shared-object hot spots)
│   │   ↔ Party objects               → opt-in shared ownership with explicit allowed-writer set
│   │   ⇢ alternative: derived objects (parent-child) when ownership is hierarchical
│   │
│   ├── Immutable (frozen)            → freeze_object(); read-only by anyone
│   │   ⊃ Common use: published packages, configuration constants
│   │
│   ├── Wrapped                       → object stored inside another object's fields
│   │   → Move type system § store ability
│   │   ↔ ParentObject { child: Child } pattern
│   │
│   └── Party                         📖 docs: .sui-docs/develop/objects/object-ownership/party.mdx
│       → bounded-writer-set shared object; cheaper than full shared
│
├── Dynamic fields                    📖 docs: .sui-docs/develop/objects/dynamic-fields.mdx
│   ⊃ dynamic_field    — heterogeneous typed children at arbitrary keys
│   ⊃ dynamic_object_field — children that are themselves Sui objects (preserve UID)
│   ⇢ alternative to: VecMap, Table — when you need unbounded growth or rare access
│   ⤳ skill: move-code-review (DOF lookups can hide gas costs; audit access patterns)
│
├── Derived objects                   📖 docs: .sui-docs/develop/objects/derived-objects.mdx
│   → object whose UID is deterministically derived from a parent UID + index
│   ↔ replaces ad-hoc Table<address, Object> patterns
│   ⊃ enables explicit parent-child ownership without dynamic fields
│
├── Versioning                        📖 docs: .sui-docs/develop/objects/versioning.mdx
│   ↔ Each mutation bumps the object version (used by consensus + replay)
│   ↔ Package upgrades — `version: u64` field convention for upgradeable structs
│   ⤳ skill: move-code-review (version mismatch = silent foot-gun)
│
└── Transfer functions                📖 docs: .move-book-docs/book/appendix/transfer-functions.md
    ├── transfer::transfer(obj, addr)        → address-owned
    ├── transfer::share_object(obj)          → shared
    ├── transfer::freeze_object(obj)         → immutable
    ├── transfer::public_transfer(obj, addr) → store-only types
    └── ⤳ skill: move-code-review (blind transfers are a common SEC-AC bug class)
```

**Decision matrix — which ownership do I pick?**

| Use case | Pick | Why |
|---|---|---|
| User-owned NFT or coin | Address-owned | Fast path, no consensus, one user mutates |
| Auction, AMM pool, registry | Shared | Multiple users mutate concurrently |
| Configuration / on-chain constant | Immutable | Read-many, never write |
| Inventory of children with shared state | Wrapped or DOF | Composition over reference |
| Ordered collection at a parent | Derived objects | Deterministic addresses, no DOF gas |
| Bounded multi-writer (committees, oracles) | Party | Cheaper than full shared, bounded set |

⤳ skill: move-code-review (the single most common review finding is "wrong ownership choice")

---

## Authorization patterns

Move's compile-time guarantees enable authorization patterns that don't require
runtime checks. The toolkit below is what idiomatic Sui packages use to express
"who is allowed to do what" without storing access-control lists. Pick the lightest
pattern that expresses your intent.

```
AUTHORIZATION                         📖 docs: .move-book-docs/book/programmability/authorization-patterns.md
│
├── Capability                        📖 docs: .move-book-docs/book/programmability/capability.md
│   → owning a `XxxCap` object proves the right to perform privileged ops
│   ↔ TreasuryCap<T>, UpgradeCap, Publisher are the canonical examples
│   ⊃ Object capability — capability *is* the object, not a field of it
│   ⤳ skill: move-code-review (assert holder; never accept by-ref a cap from untrusted caller)
│   ⇢ alternative: address allowlist when multiple operators rotate frequently
│
├── Witness pattern                   📖 docs: .move-book-docs/book/programmability/witness-pattern.md
│   → zero-sized struct passed by value to prove caller's identity at the type level
│   → Move type system § phantom types
│   ↔ pairs with generic functions: `fun do_x<T: drop>(_w: T, ...)`
│   ⇢ alternative: Capability when the proof must be transferable/storable
│
├── One-time witness (OTW)            📖 docs: .move-book-docs/book/programmability/one-time-witness.md
│   → witness type whose name == module name (uppercase); guaranteed instantiated once
│   → consumed in module init; commonly used to construct singleton coins/treasuries
│   ⤳ skill: move-code-review (audit OTW consumption — must be by-value, drop-only)
│   ↔ coin::create_currency<T>(otw, ...)
│
├── Hot potato pattern                📖 docs: .move-book-docs/book/programmability/hot-potato-pattern.md
│   → struct WITHOUT drop ability; caller MUST consume via specific function
│   ↔ flash loans, transient receipts, in-progress trade objects
│   ⤳ skill: move-code-review (every hot-potato needs an exhaustive consume function)
│   ⇢ alternative: Option-wrapped builder when the consume step is optional
│
├── Publisher                         📖 docs: .move-book-docs/book/programmability/publisher.md
│   → struct evidencing original package authorship (`from_package<T>(pub)` at OTW init)
│   ↔ Display, transfer-policy: gated by Publisher
│   ⤳ skill: move-code-quality (idiomatic packages own a Publisher per type family)
│
└── Object capability                 📖 docs: .move-book-docs/book/programmability/object-capability.md
    → cap is itself a `key`-able object, not just a struct field
    ↔ Address-owned ownership keeps the cap isolated to one user
    ⊃ Common in DeFi: PoolAdminCap, OracleSourceCap, BridgeOperatorCap
```

**When to use what — quick decision flow:**

- Need to gate a function on caller identity, no transferable proof? → **Witness**
- Privileged op tied to a one-shot module init? → **OTW**
- Privileged op tied to a transferable, long-lived role? → **Capability** (probably Object Capability)
- Caller must complete a multi-step protocol or pay/refund? → **Hot potato**
- Authorship-of-a-package check (Display/policy ops)? → **Publisher**

⤳ skill: move-code-review (every authorization choice should match this flow; deviations are usually bugs)

---

## Transactions & lifecycle

Sui transactions are *programmable transaction blocks* (PTBs) — composable command
chains that can move objects, call entry functions, and split/merge in one signed
batch. Understanding PTB structure, gas model, and authentication paths is required
before reviewing any transaction-building code (Move side or TS SDK side).

```
TRANSACTIONS                          📖 docs: .sui-docs/develop/transactions/index.mdx
├── PTB structure                     📖 docs: .sui-docs/develop/transactions/ptbs/
├── Transaction auth                  📖 docs: .sui-docs/develop/transactions/transaction-auth/
├── Gas model                         📖 docs: .sui-docs/develop/transaction-payment/gas-in-sui.mdx
├── Sponsored / gasless txns          📖 docs: .sui-docs/develop/transaction-payment/sponsor-txn.mdx
└── ⤳ skill: move-pr-review
```

Stub — fleshed in v2 follow-up. Cross-reference `Sui object model § Object ownership`
for fast-path vs. consensus, and `Authorization patterns` for entry-function guards.

---

## Transfer policies & kiosk

Transfer policies define rules a buyer/seller must satisfy before an object can change
hands. Kiosk is the canonical marketplace primitive built on top.

```
TRANSFER POLICIES                     📖 docs: .sui-docs/develop/objects/transfers/
├── transfer-policies                 → declare rules; policy is `T`-typed
├── custom-rules                      → royalties, allowlist, time-locks
├── Kiosk                             📖 docs: .sui-docs/onchain-finance/kiosk/
└── ⤳ skill: move-code-review
```

Stub — flesh in follow-up when chunk extraction tests this section.

---

## Cryptography & primitives

Sui exposes battle-tested primitives directly from the `sui::*` framework rather than
forcing every package to vendor its own crypto. Use the framework primitives unless
you have a specific, audited reason to roll your own.

```
CRYPTOGRAPHY                          📖 docs: .sui-docs/develop/cryptography/
│
├── Hashing
│   ├── std::hash::sha2_256            → general-purpose
│   ├── std::hash::sha3_256
│   └── sui::hash::keccak256, blake2b256  → Ethereum-compatibility & Merkle proofs
│   ⤳ skill: move-code-review (commit-reveal needs domain-separation; never raw-hash user input)
│
├── Signing & verification             📖 docs: .sui-docs/develop/cryptography/signing.mdx
│   ├── ed25519, secp256k1, secp256r1  → on-chain verify primitives
│   ├── BLS12-381                      → aggregatable signatures, threshold schemes
│   └── Multisig & passkey auth        → tx-level, not Move-call-level
│       ↔ § Transactions § Transaction auth
│
├── ZK primitives
│   ├── Groth16 verifier               📖 docs: .sui-docs/develop/cryptography/groth16.mdx
│   ├── ECVRF                          📖 docs: .sui-docs/develop/cryptography/ecvrf.mdx
│   └── zkLogin                        📖 docs: .sui-docs/sui-stack/zklogin-integration/
│       ⤳ skill: move-code-review (audit circuit-input encoding, never trust caller-supplied verifier params)
│
├── Randomness                        📖 docs: .sui-docs/sui-stack/on-chain-primitives/randomness-onchain.mdx
│   → consensus-driven on-chain RNG via `sui::random::Random` shared object
│   ⤳ skill: move-code-review (never use timestamps, tx hash, or coin balances as randomness)
│   ⇢ alternative: commit-reveal with off-chain entropy when external sources are required
│
└── Threshold/aggregation
    ↔ Seal § threshold encryption (off-chain peer to this on-chain primitive set)
```

**Cross-references**

- For *secrets/encryption at rest*, use **Seal** (off-chain, threshold key management) — not Move-side crypto.
  ⤳ Seal section below
- For *blob storage with availability commitments*, use **Walrus** — Sui anchors the commitment, Walrus stores the bytes.
  ⤳ Walrus section below
- For *commit-reveal randomness in DeFi protocols*, layer ECVRF + on-chain Random.
  ⤳ skill: oz-math (numerics often needed alongside)

---

## Onchain finance & math

DeFi-shaped Move packages share a common toolkit: `Coin<T>` / `Balance<T>` for fungible
value, closed-loop tokens for permissioned currencies, DeepBookV3 for orderbook
liquidity, and fixed-point math primitives for price/share calculations.

```
ONCHAIN FINANCE                       📖 docs: .sui-docs/onchain-finance/
├── Coin<T>, Balance<T>, TreasuryCap<T>  → standard fungible currency
├── Closed-loop tokens                   → permissioned movement, action-request rules
├── DeepBookV3 orderbook                 → permissionless / permissioned pools
├── Fixed-point math                     → mul_div, rate calculations, share accounting
└── ⤳ skill: oz-math (math safety audit)
   ⤳ skill: move-code-review (overflow, rounding bias, MEV exposure)
```

Stub — flesh in v2 follow-up.

---

## Walrus storage

Walrus is a decentralized blob-storage protocol anchored on Sui. The on-chain object
holds a commitment + availability proof; the blob bytes live in the Walrus storage
network. Use Walrus when you need verifiable availability without paying Sui storage
fees per byte.

```
WALRUS                                📖 docs: .walrus-docs/system-overview/
├── Blob model + Quilt                → small-blob bundling
├── Walrus Sites                      → static-site hosting on Walrus
├── HTTP API & TS SDK                 → publish/read paths
└── Operator / publisher / aggregator → infrastructure roles
   ↔ Sui § Sui object model (Walrus blob registration creates Sui objects)
```

Stub — flesh in v2 follow-up. For operations questions consult the operator-guide subtree.

---

## Seal secrets

Seal is a threshold-encryption / decentralized key-management protocol on Sui.
Use Seal when application data must be *encrypted at rest* and decryption authority
is policy-gated (committee threshold, time-lock, access-control).

```
SEAL                                  📖 docs: .seal-docs/Design.mdx
├── Key servers (committees)
├── Aggregation protocol              → threshold-decryption
├── Access-policy patterns
└── Security best practices           📖 docs: .seal-docs/SecurityBestPractices.mdx
   ↔ Sui § Authorization patterns (policy gates often use Capability or Witness)
   ↔ Cryptography & primitives § Threshold/aggregation
```

Stub — flesh in v2 follow-up.

---

## TypeScript SDK & 2.0 migration

Any TypeScript code that imports `@mysten/*` should be assumed potentially on the
1.x API; SDK 2.0 (March 2026) introduces breaking changes that pre-cutoff training
data does not know. The 2.0 split client paths — `@mysten/sui/jsonRpc` vs.
`@mysten/sui/grpc` — and removed several legacy helpers in favor of client-extension
plug-ins.

```
TS SDK                                📖 docs: .ts-sdk-docs/sui/
├── Clients                           → SuiJsonRpcClient, SuiGrpcClient (2.0)
│   ⇢ alternative to: 1.x SuiClient (deprecated)
├── Transactions builder              → tx, tx.moveCall, tx.transferObjects, ...
├── BCS serialization                 → on-chain types via bcs.struct(...)
├── dapp-kit (React)                  📖 docs: .ts-sdk-docs/dapp-kit/
├── kiosk SDK
├── payment-kit
└── SDK 2.0 migration                 📖 docs: .ts-sdk-docs/sui/migrations/sui-2.0/
   ⤳ Always read the 2.0 migration index when editing `@mysten/*` code
```

Stub — flesh in v2 follow-up. The migration index is the load-bearing read here.

---

## Tooling

```
TOOLING
├── Sui CLI                           📖 docs: .sui-docs/references/cli/
│   ⊃ sui client (network ops), sui move (build/test), sui keytool, sui ptb
├── Move 2024 edition                 📖 docs: .move-book-docs/book/before-we-begin/move-2024.md
│   ⤳ skill: move-code-quality
├── move-analyzer (LSP)               → MCP-bridged via plugin's move-lsp server
│   ⊃ tools: move_diagnostics, move_hover, move_completions, move_goto_definition
│   ⤳ skill: move-tests (LSP-driven test scaffolding)
└── sui-pilot plugin                  → this package; bundles all of the above
   ⤳ skill: move-pr-review (multi-agent orchestration on PRs)
```

Stub — flesh in v2 follow-up. The LSP integration is the single most useful tool for
the agent's day-to-day Move editing; prefer `move_diagnostics` over re-running
`sui move build` for tight iteration loops.
