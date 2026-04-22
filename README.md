# sui-pilot

<p align="center">
  <img src="sui-pilot.jpg" alt="Sui Pilot" width="600" />
</p>

A Claude Code plugin that transforms Claude into a Sui/Move development expert.

---

## Why sui-pilot?

Sui Move evolves rapidly. LLM training data goes stale fast, and agents confidently generate outdated patterns, deprecated APIs, and incorrect syntax.

sui-pilot solves this by bundling **548 documentation files** from four Mysten Labs repos directly into your Claude Code environment:

| Ecosystem   | Files | Topics                                                                  |
| ----------- | ----- | ----------------------------------------------------------------------- |
| **Sui**     | 336   | Blockchain, Move language, objects, transactions, SDKs, DeFi standards  |
| **Walrus**  | 84    | Decentralized blob storage, Walrus Sites, HTTP API, node operations     |
| **Seal**    | 14    | Secrets management, encryption, key servers, access control policies    |
| **TS SDK**  | 114   | TypeScript SDK, dapp-kit, payment-kit, kiosk, React hooks, transactions |

---

## What You Get

### Bundled Documentation

All docs are local and searchable. Claude reads them before generating code — no hallucinated APIs, no deprecated patterns.

### MCP Tools (LSP Integration)

Real-time feedback from `move-analyzer`:

| Tool                   | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `move_diagnostics`     | Get compiler warnings and errors for a Move file |
| `move_hover`           | Get type information at a position                |
| `move_completions`     | Get completion suggestions                        |
| `move_goto_definition` | Navigate to symbol definitions                    |

### Skills

| Command              | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `/move-code-quality` | Move Book Code Quality Checklist compliance      |
| `/move-code-review`  | Security and architecture review                 |
| `/move-tests`        | Test generation best practices                   |
| `/oz-math`           | OpenZeppelin math library recommendations        |

### Specialized Agent

The `sui-pilot-agent` enforces a doc-first workflow: consult documentation before writing code, use LSP for real-time validation.

---

## Installation

### From the marketplace (recommended)

sui-pilot hosts its own Claude Code plugin marketplace. Inside Claude Code:

```
/plugin marketplace add alilloig/sui-pilot
/plugin install sui-pilot@sui-pilot
```

Then restart Claude Code — MCP servers launch at session start.

The MCP server bundle ships prebuilt with the plugin, so end users do not need Node.js or pnpm installed.

> Must be added via GitHub (`alilloig/sui-pilot`) or a git URL. A raw `marketplace.json` URL will not resolve the plugin's `./` source.

### Requirements

| Component            | Version      | Notes                                                                  |
| -------------------- | ------------ | ---------------------------------------------------------------------- |
| suiup                | Latest       | `curl -fsSL https://sui.io/install.sh \| sh`                           |
| sui + move-analyzer  | Same version | **Must match versions** — install both via suiup                       |
| Claude Code          | Latest       | Plugin host environment                                                |
| Node.js              | 18+          | Used to run the bundled MCP server (usually already present)           |

### Installing the Sui Toolchain

[suiup](https://docs.sui.io/guides/developer/getting-started/sui-install) is the official Sui version manager:

```bash
# Install suiup
curl -fsSL https://sui.io/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"  # Add to shell profile

# Install sui and move-analyzer (versions must match!)
suiup install sui
suiup install move-analyzer

# Verify
sui --version
move-analyzer --version
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

## For Other AI Agents

sui-pilot also works as a standalone documentation source for non-Claude Code environments:

1. Clone or copy this repo into your workspace
2. Point your AI agent at the project
3. The agent reads `AGENTS.md` to discover available documentation

The `AGENTS.md` file is a compact, pipe-delimited index that any AI agent can parse. It includes a warning: *"What you remember about Sui and Move is WRONG or OUTDATED — always search these docs first."*

---

## Keeping Docs Up to Date

### Why Local Docs?

LLMs have a knowledge cutoff. Sui Move evolves rapidly — new framework methods, changed APIs, deprecated patterns. An LLM trained 6 months ago will confidently generate code that no longer compiles or follows outdated conventions.

sui-pilot solves this by bundling documentation locally. The agent reads current docs before generating code, not stale training data.

### Why Sync from Upstream?

The docs are extracted directly from the official MystenLabs repositories — the same source that powers docs.sui.io, docs.walrus.site, and docs.seal.xyz. This ensures accuracy and consistency with what developers see in the official documentation.

| Ecosystem | Repository                                                | Doc Path                 |
| --------- | --------------------------------------------------------- | ------------------------ |
| Sui       | [MystenLabs/sui](https://github.com/MystenLabs/sui)       | `docs/content/`          |
| Walrus    | [MystenLabs/walrus](https://github.com/MystenLabs/walrus) | `docs/content/`          |
| Seal      | [MystenLabs/seal](https://github.com/MystenLabs/seal)     | `docs/content/`          |
| TS SDK    | [MystenLabs/ts-sdks](https://github.com/MystenLabs/ts-sdks) | `packages/docs/content/` |

### Updating the Docs

Run these scripts periodically (e.g., monthly, or before a major project):

```bash
./sync-docs.sh           # Pull latest from MystenLabs repos
./generate-docs-index.sh # Regenerate AGENTS.md index
```

The sync script clones or pulls each upstream repo and copies the `docs/content/` directory into the corresponding `.{ecosystem}-docs/` folder. The index script walks these directories and generates `AGENTS.md` — a compact, pipe-delimited file list that AI agents parse to discover available documentation.

---

## Plugin Structure

```
sui-pilot/
├── .claude-plugin/plugin.json   # Plugin manifest
├── agents/sui-pilot-agent.md    # Specialized Sui Move agent
├── skills/                      # Bundled skills (quality, review, tests)
├── mcp/move-lsp-mcp/            # MCP server wrapping move-analyzer
├── .sui-docs/                   # 336 Sui documentation files
├── .walrus-docs/                # 84 Walrus documentation files
├── .seal-docs/                  # 14 Seal documentation files
├── .ts-sdk-docs/                # 114 TS SDK documentation files
└── AGENTS.md                    # Doc index for AI discovery
```

---

## Troubleshooting

### MCP tools not appearing

Restart Claude Code completely (close and reopen). MCP servers launch at session start, not on plugin reload.

Verify the installed plugin's manifest declares the MCP server:
```bash
cat ~/.claude/plugins/cache/sui-pilot/*/*/.claude-plugin/plugin.json
```

### LSP tools return "move-analyzer not found"

```bash
suiup install move-analyzer
which move-analyzer  # Should show ~/.local/bin/move-analyzer
```

If it shows `~/.cargo/bin/move-analyzer`, you have an old cargo version shadowing suiup:
```bash
mv ~/.cargo/bin/move-analyzer ~/.cargo/bin/move-analyzer.bak
```

### LSP crashes with "Max restarts exceeded"

Version mismatch between `sui` and `move-analyzer`:

```bash
sui --version
move-analyzer --version  # Must match!
```

Fix with:
```bash
suiup update sui
suiup update move-analyzer
```

Then restart Claude Code to reset the crash counter.

### MCP server fails to start

The plugin ships a prebuilt bundle at `mcp/move-lsp-mcp/dist/index.js`. Confirm it was copied into the plugin cache:

```bash
ls ~/.claude/plugins/cache/sui-pilot/*/*/mcp/move-lsp-mcp/dist/index.js
```

If the file is missing, remove and reinstall the plugin from the marketplace:

```
/plugin uninstall sui-pilot@sui-pilot
/plugin marketplace update sui-pilot
/plugin install sui-pilot@sui-pilot
```

---

## Limitations

sui-pilot is designed for Claude Code. Some capabilities are environment-specific:

| Feature | Claude Code | Other AI Agents |
|---------|-------------|-----------------|
| Bundled documentation | Yes | Yes (read AGENTS.md) |
| MCP tools (diagnostics, hover, etc.) | Yes | No |
| Skills (/move-code-quality, etc.) | Yes | No |
| Specialized sui-pilot-agent | Yes | No |

**Other limitations:**

- **move-analyzer required separately**: LSP tools require `move-analyzer` to be installed via `suiup install move-analyzer`. The plugin does not bundle move-analyzer.
- **Version matching critical**: `sui` and `move-analyzer` must be the same version or LSP will crash.
- **macOS and Linux only**: Windows is not officially supported.
- **Documentation lag**: Bundled docs are point-in-time snapshots. Run `./sync-docs.sh` to update.

---

## Contributing / local development

For local iteration on the plugin, clone the repo and load it with `--plugin-dir` instead of installing from the marketplace:

```bash
git clone https://github.com/alilloig/sui-pilot.git
cd sui-pilot

# Build the MCP bundle after changes to mcp/move-lsp-mcp/src/
pnpm --dir mcp/move-lsp-mcp install
pnpm --dir mcp/move-lsp-mcp build

# Launch Claude Code with this checkout as the active plugin
claude --plugin-dir "$(pwd)"
```

Commit the rebuilt `mcp/move-lsp-mcp/dist/index.js` whenever `src/` changes — the bundle ships with the plugin.

---

## Support

- **Report issues**: [github.com/alilloig/sui-pilot/issues](https://github.com/alilloig/sui-pilot/issues)
- **Verify installation**: Run `./scripts/verify.sh` on a local checkout to diagnose problems

---

## License

MIT
