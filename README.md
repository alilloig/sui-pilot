# Sui Pilot

<p align="center">
  <img src="sui-pilot.png" alt="Sui Pilot" width="600" />
</p>

<p align="center">
  A documentation copilot for AI agents working with Sui and Move.
</p>

---

## What is sui-pilot?

sui-pilot is a curated, local knowledge base of Sui blockchain and Move language documentation, designed to be consumed by AI coding agents.

Sui Move evolves rapidly. LLM training data goes stale fast, and agents confidently generate outdated patterns, deprecated APIs, and incorrect syntax. sui-pilot solves this by giving agents access to current, comprehensive documentation right inside your project — 180 MDX files covering concepts, guides, references, and standards.

## How It Works

sui-pilot has two components:

- **`AGENTS.md`** — A compact, pipe-delimited index at the repo root. AI agents parse this file to discover available documentation. It includes a warning: *"What you remember about Sui and Move is WRONG or OUTDATED — always search these docs first."*

- **`.sui-docs/`** — The documentation directory. Contains MDX files organized into four top-level categories, each with nested subdirectories.

There is no build step, no runtime, and no dependencies. It's a read-only reference that agents search and read as needed.

## Quick Start

1. **Clone or copy** this repo into your workspace.
2. **Point your AI agent at the project** — add it as context, include it in your workspace, or work within the directory.
3. The agent reads `AGENTS.md`, discovers the doc structure, and can then search and read any file in `.sui-docs/`.

That's it. The agent handles the rest.

## Documentation Coverage

| Category | Topics |
|---|---|
| **Concepts** | Object model, ownership types, dynamic fields, cryptography (zkLogin, multisig, passkeys, Nautilus), tokenomics, architecture, consensus, transactions, transfers, custom indexing |
| **Guides** | Getting started, Sui 101, advanced topics (randomness, GraphQL, local fee markets, Move 2024 migration), app examples (blackjack, coin flip, counter, oracle, plinko, reviews, tic-tac-toe, trustless swap, weather oracle), coins, NFTs, cryptography |
| **References** | CLI (client, keytool, Move, PTB, replay, validator), API, GraphQL, SDKs, framework reference, IDE support, glossary |
| **Standards** | Closed-loop tokens, DeepBook v3, Display, Kiosk, Wallet Standard, Payment Kit |

## Keeping Docs Up to Date

If the documentation becomes stale, update `.sui-docs/` from the [Sui docs source folder](https://github.com/MystenLabs/sui/tree/main/docs) in the official Sui repository — this is the source of truth from which the docs site is generated. The `AGENTS.md` index should be regenerated to reflect any structural changes.
