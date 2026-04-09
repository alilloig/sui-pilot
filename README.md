# sui-pilot

A documentation copilot for AI agents working with Sui, Walrus, and Seal.

---

## What is sui-pilot?

sui-pilot is a curated, local knowledge base designed to be consumed by AI coding agents. It contains documentation for three ecosystems maintained by [Mysten Labs](https://github.com/MystenLabs):

| Ecosystem | Directory | Files | Topics |
|---|---|---|---|
| **Sui** | `.sui-docs/` | 336 | Blockchain, Move language, objects, transactions, SDKs, DeFi standards |
| **Walrus** | `.walrus-docs/` | 84 | Decentralized blob storage, Walrus Sites, TypeScript SDK, HTTP API, operators |
| **Seal** | `.seal-docs/` | 14 | Secrets management, encryption, key servers, access control policies |

Sui Move evolves rapidly. LLM training data goes stale fast, and agents confidently generate outdated patterns, deprecated APIs, and incorrect syntax. sui-pilot solves this by giving agents access to current, comprehensive documentation right inside your project.

## How It Works

sui-pilot has three components:

- **`AGENTS.md`** — A compact, pipe-delimited index at the repo root. AI agents parse this file to discover available documentation across all three ecosystems. It includes a warning: *"What you remember about Sui and Move is WRONG or OUTDATED — always search these docs first."*

- **`CLAUDE.md`** — Follows the [Vercel AI-ready project setup](https://nextjs.org/blog/next-16-2-ai#ai-ready-project-setup) pattern with an `@AGENTS.md` directive that auto-includes the index as context for Claude Code. Also provides an ecosystem routing table.

- **`.sui-docs/`, `.walrus-docs/`, `.seal-docs/`** — The documentation directories. Contains MDX files organized by topic, synced from the official upstream repositories.

There is no build step, no runtime, and no dependencies. It's a read-only reference that agents search and read as needed.

## Quick Start

1. **Clone or copy** this repo into your workspace.
2. **Point your AI agent at the project** — add it as context, include it in your workspace, or work within the directory.
3. The agent reads `AGENTS.md`, discovers the doc structure, and can then search and read any file in the doc directories.

That's it. The agent handles the rest.

## Documentation Coverage

| Category | Topics |
|---|---|
| **Sui — Concepts** | Object model, ownership types, dynamic fields, cryptography (zkLogin, multisig, passkeys, Nautilus), tokenomics, architecture, consensus, transactions, transfers, custom indexing |
| **Sui — Guides** | Getting started, developer guides, advanced topics (randomness, GraphQL, local fee markets), app examples, digital assets (coins, NFTs, tokenization), cryptography, operators, validators |
| **Sui — References** | CLI, API, GraphQL, SDKs, framework reference, IDE support, glossary, package managers |
| **Sui — Standards** | Closed-loop tokens, DeepBook v3, Kiosk, Wallet Standard, Payment Kit, PAS |
| **Walrus** | Core concepts, blob storage/reading, Walrus Sites (publishing, CI/CD, custom domains, portals), TypeScript SDK, HTTP API, operator guide, troubleshooting |
| **Seal** | Design, getting started, using Seal, key server operations, CLI, example patterns, security best practices, pricing |

## Keeping Docs Up to Date

sui-pilot includes sync scripts that pull the latest documentation directly from the upstream repos:

```bash
./sync-docs.sh           # Pull latest docs from upstream MystenLabs repos
./generate-agents-md.sh  # Regenerate AGENTS.md index from local files
```

### Upstream Sources

| Ecosystem | Repository | Doc Path |
|---|---|---|
| Sui | [MystenLabs/sui](https://github.com/MystenLabs/sui) | `docs/content/` |
| Walrus | [MystenLabs/walrus](https://github.com/MystenLabs/walrus) | `docs/content/` |
| Seal | [MystenLabs/seal](https://github.com/MystenLabs/seal) | `docs/content/` |

## AI Agent Files

| File | Purpose |
|---|---|
| `AGENTS.md` | Pipe-delimited file index for AI agent discovery |
| `CLAUDE.md` | Claude Code directive with `@AGENTS.md` auto-include |
| `llms.txt` | Standard AI discoverability ([llmstxt.org](https://llmstxt.org)) |
