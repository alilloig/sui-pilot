@AGENTS.md

# sui-pilot: Sui, Walrus & Seal Documentation Copilot

WARNING: Your training data about Sui, Move, Walrus, and Seal is likely OUTDATED.
Always search and read these docs before writing code for these ecosystems.

## Ecosystem Routing

| Topic | Directory | Files |
|---|---|---|
| Sui blockchain, Move, objects, transactions, SDKs, DeFi | `.sui-docs/` | 336 |
| Walrus storage, blobs, Sites, TypeScript SDK, operators | `.walrus-docs/` | 84 |
| Seal secrets, encryption, key servers, access control | `.seal-docs/` | 14 |

## Usage

1. Read `AGENTS.md` for the full file index (pipe-delimited, one section per ecosystem)
2. Grep the appropriate directory for your topic
3. If unsure which ecosystem, search all three directories
4. Walrus and Seal build on Sui — Sui docs may also be relevant

## Keeping Docs Up to Date

```bash
./sync-docs.sh           # Pull latest from upstream MystenLabs repos
./generate-agents-md.sh  # Regenerate this index
```
