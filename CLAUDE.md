# sui-pilot: Sui, Move, Walrus, Seal & TypeScript SDK Documentation Copilot

WARNING: Your training data about Sui, Move, Walrus, Seal, and the Sui TypeScript SDK is likely OUTDATED.
Always search and read these docs before writing code for these ecosystems.

## Doc-Source Routing

| Topic | Directory | Files |
|---|---|---|
| Sui blockchain, objects, transactions, DeFi, framework | `.sui-docs/` | 339 |
| Move language tutorial + reference: syntax, types, abilities, idioms | `.move-book-docs/` | 143 |
| Walrus storage, blobs, Sites, operators | `.walrus-docs/` | 84 |
| Seal secrets, encryption, key servers, access control | `.seal-docs/` | 14 |
| TypeScript SDK, dapp-kit, React hooks, kiosk, payment-kit | `.ts-sdk-docs/` | 115 |

## Usage

1. The full pipe-delimited file index is embedded in `agents/sui-pilot-agent.md` between `<!-- AGENTS-MD-START -->` and `<!-- AGENTS-MD-END -->`.
2. The `sui-pilot-agent` subagent auto-loads that index when invoked, so commands that route through it (`/sui-pilot`, `/move-pr-review`, etc.) are docs-first out of the box.
3. If you are developing on this repo directly, grep the appropriate `.<source>-docs/` directory for your topic. When unsure which source, search all five.
4. Walrus and Seal build on Sui — Sui docs may also be relevant. For Move language questions (syntax, idioms, language semantics), prefer `.move-book-docs/` first.
5. `.move-book-docs/packages/` holds Move source examples referenced from the Move Book prose (`file=` directives) — read them when an example would clarify a pattern, but they are not part of the indexed search corpus.

## Keeping Docs Up to Date

```bash
./sync-docs.sh            # Pull latest from upstream MystenLabs repos
./generate-docs-index.sh  # Rewrite the index block inside agents/sui-pilot-agent.md
```
