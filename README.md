# sui-pilot

<p align="center">
  <img src="sui-pilot.png" alt="Sui Pilot" width="600" />
</p>

A documentation copilot and Claude Code plugin for AI agents working with Sui, Walrus, and Seal.

---

## What is sui-pilot?

sui-pilot is a curated, local knowledge base designed to be consumed by AI coding agents. It contains documentation for three ecosystems maintained by [Mysten Labs](https://github.com/MystenLabs):

| Ecosystem  | Directory       | Files | Topics                                                                        |
| ---------- | --------------- | ----- | ----------------------------------------------------------------------------- |
| **Sui**    | `.sui-docs/`    | 336   | Blockchain, Move language, objects, transactions, SDKs, DeFi standards        |
| **Walrus** | `.walrus-docs/` | 84    | Decentralized blob storage, Walrus Sites, TypeScript SDK, HTTP API, operators |
| **Seal**   | `.seal-docs/`   | 14    | Secrets management, encryption, key servers, access control policies          |

Sui Move evolves rapidly. LLM training data goes stale fast, and agents confidently generate outdated patterns, deprecated APIs, and incorrect syntax. sui-pilot solves this by giving agents access to current, comprehensive documentation right inside your project.

---

## Claude Code Plugin

sui-pilot is also a full Claude Code plugin that transforms Claude into a Sui/Move development expert with:

- **Doc-grounded guidance** — Enforces doc-first workflow before code generation
- **Real-time LSP integration** — move-analyzer diagnostics, hover, completions, navigation
- **Code quality skills** — Move 2024 Edition compliance and security review
- **Test generation** — Following Move testing best practices

### MCP Tools

| Tool                   | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `move_diagnostics`     | Get compiler warnings and errors for a Move file |
| `move_hover`           | Get type information at a position               |
| `move_completions`     | Get completion suggestions                       |
| `move_goto_definition` | Navigate to symbol definitions                   |

### Bundled Skills

| Skill             | Command              | Purpose                                     |
| ----------------- | -------------------- | ------------------------------------------- |
| move-code-quality | `/move-code-quality` | Move Book Code Quality Checklist compliance |
| move-code-review  | `/move-code-review`  | Security and architecture review            |
| move-tests        | `/move-tests`        | Test generation best practices              |

---

## Installation

### As Documentation Only

1. **Clone or copy** this repo into your workspace.
2. **Point your AI agent at the project** — add it as context, include it in your workspace, or work within the directory.
3. The agent reads `AGENTS.md`, discovers the doc structure, and can then search and read any file in the doc directories.

### As Claude Code Plugin

#### Quick Setup (Recommended)

```bash
# Clone to plugins directory
cd ~/.claude/plugins
git clone https://github.com/alilloig/sui-pilot.git

# Run automated setup
cd sui-pilot
./scripts/setup.sh
```

The setup script will:

- Verify Node.js 18+ and pnpm are installed
- Build the MCP server
- Run tests to verify everything works
- Optionally install move-analyzer (prompts for confirmation)

#### Manual Installation

##### Prerequisites

<<<<<<< HEAD
| Requirement | Purpose | Check |
|-------------|---------|-------|
| Node.js 18+ | MCP server runtime | `node --version` |
| pnpm | Package management | `pnpm --version` |
| suiup | Sui toolchain manager | `suiup --version` |
| sui + move-analyzer | Sui CLI and LSP | `sui --version && move-analyzer --version` |
=======
| Requirement   | Purpose                | Check                 |
| ------------- | ---------------------- | --------------------- |
| Node.js 18+   | MCP server runtime     | `node --version`      |
| pnpm          | Package management     | `pnpm --version`      |
| Rust/Cargo    | Building move-analyzer | `cargo --version`     |
| move-analyzer | LSP features           | `which move-analyzer` |
>>>>>>> ff14854 (pilot whaleclear)

##### Install suiup (Sui Toolchain Manager)

[suiup](https://docs.sui.io/guides/developer/getting-started/sui-install) is the official Sui version manager, similar to rustup for Rust. It manages `sui`, `move-analyzer`, and other Sui tools.

```bash
# Install suiup
curl -fsSL https://sui.io/install.sh | sh

# Add to PATH (add this to your shell profile)
export PATH="$HOME/.local/bin:$PATH"
```

##### Install sui and move-analyzer

> **Important**: `sui` and `move-analyzer` must be the **same version**. Version mismatches cause LSP crashes.

```bash
# Install latest sui from testnet release
suiup install sui

# Install matching move-analyzer
suiup install move-analyzer

# Verify versions match
sui --version          # e.g., sui 1.69.2-...
move-analyzer --version  # e.g., move-analyzer 1.69.2-...
```

If you have an old `move-analyzer` installed via cargo that shadows the suiup version:
```bash
# Check which one is active
which move-analyzer

# If it shows ~/.cargo/bin/move-analyzer, rename it
mv ~/.cargo/bin/move-analyzer ~/.cargo/bin/move-analyzer.bak
```

##### Alternative: Install via Cargo (Not Recommended)

If you can't use suiup, you can build from source. This is slower and risks version mismatches:

```bash
# Install from official MystenLabs Sui repository
cargo install --git https://github.com/MystenLabs/sui.git move-analyzer
```

> **Note**: This compiles ~500 crates. Takes ~5-10 minutes. Requires ~1GB disk space.

##### Build MCP Server

```bash
cd ~/.claude/plugins/sui-pilot/mcp/move-lsp-mcp
pnpm install
pnpm build
pnpm test  # Should show 80+ tests passing
```

##### Restart Claude Code

After installation, restart Claude Code completely (close and reopen). The MCP server starts on session launch, not on plugin reload.

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

- **`AGENTS.md`** — A compact, pipe-delimited index at the repo root. AI agents parse this file to discover available documentation across all three ecosystems. It includes a warning: _"What you remember about Sui and Move is WRONG or OUTDATED — always search these docs first."_

- **`CLAUDE.md`** — Follows the [Vercel AI-ready project setup](https://nextjs.org/blog/next-16-2-ai#ai-ready-project-setup) pattern with an `@AGENTS.md` directive that auto-includes the index as context for Claude Code.

- **`.sui-docs/`, `.walrus-docs/`, `.seal-docs/`** — The documentation directories containing MDX files organized by topic, synced from the official upstream repositories.

---

## Documentation Coverage

| Category             | Topics                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sui — Concepts**   | Object model, ownership types, dynamic fields, cryptography (zkLogin, multisig, passkeys, Nautilus), tokenomics, architecture, consensus, transactions, transfers, custom indexing         |
| **Sui — Guides**     | Getting started, developer guides, advanced topics (randomness, GraphQL, local fee markets), app examples, digital assets (coins, NFTs, tokenization), cryptography, operators, validators |
| **Sui — References** | CLI, API, GraphQL, SDKs, framework reference, IDE support, glossary, package managers                                                                                                      |
| **Sui — Standards**  | Closed-loop tokens, DeepBook v3, Kiosk, Wallet Standard, Payment Kit, PAS                                                                                                                  |
| **Walrus**           | Core concepts, blob storage/reading, Walrus Sites (publishing, CI/CD, custom domains, portals), TypeScript SDK, HTTP API, operator guide, troubleshooting                                  |
| **Seal**             | Design, getting started, using Seal, key server operations, CLI, example patterns, security best practices, pricing                                                                        |

---

## Keeping Docs Up to Date

sui-pilot includes sync scripts that pull the latest documentation directly from the upstream repos:

```bash
./sync-docs.sh           # Pull latest docs from upstream MystenLabs repos
./generate-agents-md.sh  # Regenerate AGENTS.md index from local files
```

### Upstream Sources

| Ecosystem | Repository                                                | Doc Path        |
| --------- | --------------------------------------------------------- | --------------- |
| Sui       | [MystenLabs/sui](https://github.com/MystenLabs/sui)       | `docs/content/` |
| Walrus    | [MystenLabs/walrus](https://github.com/MystenLabs/walrus) | `docs/content/` |
| Seal      | [MystenLabs/seal](https://github.com/MystenLabs/seal)     | `docs/content/` |

---

## AI Agent Files

| File        | Purpose                                                          |
| ----------- | ---------------------------------------------------------------- |
| `AGENTS.md` | Pipe-delimited file index for AI agent discovery                 |
| `CLAUDE.md` | Claude Code directive with `@AGENTS.md` auto-include             |
| `llms.txt`  | Standard AI discoverability ([llmstxt.org](https://llmstxt.org)) |

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

<<<<<<< HEAD
| Component | Version | Required | Notes |
|-----------|---------|----------|-------|
| Node.js | 18+ | Yes | MCP server runtime |
| pnpm | Any | Yes | Package management (`npm i -g pnpm`) |
| suiup | Latest | For LSP | Sui toolchain manager (`curl -fsSL https://sui.io/install.sh \| sh`) |
| sui + move-analyzer | Same version | For LSP | **Must match versions** - install via suiup |
| Claude Code | Latest | Yes | Plugin host environment |
=======
| Component     | Version | Required | Notes                                 |
| ------------- | ------- | -------- | ------------------------------------- |
| Node.js       | 18+     | Yes      | MCP server runtime                    |
| pnpm          | Any     | Yes      | Package management (`npm i -g pnpm`)  |
| Rust/Cargo    | Latest  | For LSP  | Only needed to build move-analyzer    |
| move-analyzer | Latest  | For LSP  | Provides actual language intelligence |
| Claude Code   | Latest  | Yes      | Plugin host environment               |
>>>>>>> ff14854 (pilot whaleclear)

---

## Troubleshooting

### MCP tools not appearing

After installing the plugin, you must **restart Claude Code completely** (close and reopen the app/terminal). MCP servers are launched at session start.

Verify the `.mcp.json` file exists at the plugin root:

```bash
cat ~/.claude/plugins/sui-pilot/.mcp.json
```

### LSP tools return "move-analyzer not found"

<<<<<<< HEAD
Install move-analyzer using suiup (recommended):
=======
Install move-analyzer from the official Sui repository:

>>>>>>> ff14854 (pilot whaleclear)
```bash
suiup install move-analyzer
```

Verify it's in your PATH:

```bash
which move-analyzer
move-analyzer --version
```

If `which` returns `~/.cargo/bin/move-analyzer` instead of `~/.local/bin/move-analyzer`, you have an old cargo-installed version shadowing the suiup one. Rename or remove it:
```bash
mv ~/.cargo/bin/move-analyzer ~/.cargo/bin/move-analyzer.bak
```

### LSP crashes with "Max restarts exceeded"

This usually means **version mismatch** between `sui` and `move-analyzer`:

```bash
# Check versions - they should match
sui --version
move-analyzer --version
```

If they differ, update both to the same version:
```bash
suiup update sui
suiup update move-analyzer
suiup default set "sui@testnet-1.69.2"  # or latest
suiup default set "move-analyzer@testnet-1.69.2"
```

After fixing versions, **restart Claude Code completely** to reset the crash counter.

### MCP server fails to start

Check the build:

```bash
cd ~/.claude/plugins/sui-pilot/mcp/move-lsp-mcp
ls dist/index.js  # Should exist
pnpm test         # Should pass
```

Rebuild if needed:

```bash
pnpm install && pnpm build
```

### Tests fail

Ensure you have the correct Node.js version:

```bash
node --version  # Should be 18+
```

---

## License

MIT
