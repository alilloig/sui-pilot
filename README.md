# sui-pilot

A documentation copilot and Claude Code plugin for AI agents working with Sui, Walrus, and Seal.

---

## What is sui-pilot?

sui-pilot is a curated, local knowledge base designed to be consumed by AI coding agents. It contains documentation for three ecosystems maintained by [Mysten Labs](https://github.com/MystenLabs):

| Ecosystem | Directory | Files | Topics |
|---|---|---|---|
| **Sui** | `.sui-docs/` | 336 | Blockchain, Move language, objects, transactions, SDKs, DeFi standards |
| **Walrus** | `.walrus-docs/` | 84 | Decentralized blob storage, Walrus Sites, TypeScript SDK, HTTP API, operators |
| **Seal** | `.seal-docs/` | 14 | Secrets management, encryption, key servers, access control policies |

Sui Move evolves rapidly. LLM training data goes stale fast, and agents confidently generate outdated patterns, deprecated APIs, and incorrect syntax. sui-pilot solves this by giving agents access to current, comprehensive documentation right inside your project.

---

## Claude Code Plugin

sui-pilot is also a full Claude Code plugin that transforms Claude into a Sui/Move development expert with:

- **Doc-grounded guidance** — Enforces doc-first workflow before code generation
- **Real-time LSP integration** — move-analyzer diagnostics, hover, completions, navigation
- **Code quality skills** — Move 2024 Edition compliance and security review
- **Test generation** — Following Move testing best practices

### MCP Tools

| Tool | Description |
|------|-------------|
| `move_diagnostics` | Get compiler warnings and errors for a Move file |
| `move_hover` | Get type information at a position |
| `move_completions` | Get completion suggestions |
| `move_goto_definition` | Navigate to symbol definitions |

### Bundled Skills

| Skill | Command | Purpose |
|-------|---------|---------|
| move-code-quality | `/move-code-quality` | Move Book Code Quality Checklist compliance |
| move-code-review | `/move-code-review` | Security and architecture review |
| move-tests | `/move-tests` | Test generation best practices |

---

## Installation

### As Documentation Only

1. **Clone or copy** this repo into your workspace.
2. **Point your AI agent at the project** — add it as context, include it in your workspace, or work within the directory.
3. The agent reads `AGENTS.md`, discovers the doc structure, and can then search and read any file in the doc directories.

### As Claude Code Plugin

#### Prerequisites

- Node.js 18+
- pnpm
- move-analyzer (for LSP features)

#### Install move-analyzer

```bash
cargo install --git https://github.com/MystenLabs/sui.git sui-move-analyzer
```

#### Install the Plugin

```bash
# Clone to plugins directory
cd ~/.claude/plugins
git clone https://github.com/alilloig/sui-pilot.git

# Build MCP server
cd sui-pilot/mcp/move-lsp-mcp
pnpm install
pnpm build

# Register with Claude Code
claude plugin add ~/.claude/plugins/sui-pilot
```

---

## Quick Start

### Ask About Sui/Move

```
What are shared objects in Sui and when should I use them?
```

### Generate a Module

```
Create a Counter module in Move 2024 with increment and value functions
```

### Check Code Quality

```
/move-code-quality
```

### Security Review

```
/move-code-review
```

### Get Diagnostics

```
Check diagnostics for sources/my_module.move
```

---

## How It Works

sui-pilot has three components for documentation discovery:

- **`AGENTS.md`** — A compact, pipe-delimited index at the repo root. AI agents parse this file to discover available documentation across all three ecosystems. It includes a warning: *"What you remember about Sui and Move is WRONG or OUTDATED — always search these docs first."*

- **`CLAUDE.md`** — Follows the [Vercel AI-ready project setup](https://nextjs.org/blog/next-16-2-ai#ai-ready-project-setup) pattern with an `@AGENTS.md` directive that auto-includes the index as context for Claude Code.

- **`.sui-docs/`, `.walrus-docs/`, `.seal-docs/`** — The documentation directories containing MDX files organized by topic, synced from the official upstream repositories.

---

## Documentation Coverage

| Category | Topics |
|---|---|
| **Sui — Concepts** | Object model, ownership types, dynamic fields, cryptography (zkLogin, multisig, passkeys, Nautilus), tokenomics, architecture, consensus, transactions, transfers, custom indexing |
| **Sui — Guides** | Getting started, developer guides, advanced topics (randomness, GraphQL, local fee markets), app examples, digital assets (coins, NFTs, tokenization), cryptography, operators, validators |
| **Sui — References** | CLI, API, GraphQL, SDKs, framework reference, IDE support, glossary, package managers |
| **Sui — Standards** | Closed-loop tokens, DeepBook v3, Kiosk, Wallet Standard, Payment Kit, PAS |
| **Walrus** | Core concepts, blob storage/reading, Walrus Sites (publishing, CI/CD, custom domains, portals), TypeScript SDK, HTTP API, operator guide, troubleshooting |
| **Seal** | Design, getting started, using Seal, key server operations, CLI, example patterns, security best practices, pricing |

---

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

---

## AI Agent Files

| File | Purpose |
|---|---|
| `AGENTS.md` | Pipe-delimited file index for AI agent discovery |
| `CLAUDE.md` | Claude Code directive with `@AGENTS.md` auto-include |
| `llms.txt` | Standard AI discoverability ([llmstxt.org](https://llmstxt.org)) |

---

## Plugin Structure

```
sui-pilot/
├── .claude-plugin/plugin.json   # Plugin manifest
├── agents/sui-pilot-agent.md    # Specialized Sui Move agent
├── commands/                    # Slash commands
├── skills/                      # Bundled skills (quality, review, tests)
├── mcp/move-lsp-mcp/           # MCP server wrapping move-analyzer
├── .sui-docs/                   # Sui documentation
├── .walrus-docs/                # Walrus documentation
├── .seal-docs/                  # Seal documentation
└── AGENTS.md                    # Doc index for AI discovery
```

---

## Requirements

- **Node.js**: 18+ (for MCP server)
- **pnpm**: For package management
- **move-analyzer**: For LSP features (optional but recommended)
- **Claude Code**: Plugin host environment

---

## License

MIT
