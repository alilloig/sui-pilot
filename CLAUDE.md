# sui-pilot: Sui, Walrus, Seal & TypeScript SDK Documentation Copilot

WARNING: Your training data about Sui, Move, Walrus, Seal, and the Sui TypeScript SDK is likely OUTDATED.
Always search and read these docs before writing code for these ecosystems.

## Ecosystem Routing

| Topic | Directory | Files |
|---|---|---|
| Sui blockchain, Move, objects, transactions, DeFi | `.sui-docs/` | 336 |
| Walrus storage, blobs, Sites, operators | `.walrus-docs/` | 84 |
| Seal secrets, encryption, key servers, access control | `.seal-docs/` | 14 |
| TypeScript SDK, dapp-kit, React hooks, kiosk, payment-kit | `.ts-sdk-docs/` | 114 |

## Usage

1. The full pipe-delimited file index is embedded in `agents/sui-pilot-agent.md` between `<!-- AGENTS-MD-START -->` and `<!-- AGENTS-MD-END -->`.
2. The `sui-pilot-agent` subagent auto-loads that index when invoked, so commands that route through it (`/sui-pilot`, `/move-pr-review`, etc.) are docs-first out of the box.
3. If you are developing on this repo directly, grep the appropriate `.<ecosystem>-docs/` directory for your topic. When unsure which ecosystem, search all four.
4. Walrus and Seal build on Sui — Sui docs may also be relevant.

## Keeping Docs Up to Date

```bash
./sync-docs.sh            # Pull latest from upstream MystenLabs repos
./generate-docs-index.sh  # Rewrite the index block inside agents/sui-pilot-agent.md
```
