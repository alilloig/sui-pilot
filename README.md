# sui-pilot

<p align="center">
  <img src="sui-pilot.jpg" alt="Sui Pilot" width="600" />
</p>

A Claude Code plugin that transforms Claude into a Sui/Move development expert.

---

## Why sui-pilot?

Sui Move evolves rapidly. LLM training data goes stale fast, and agents confidently generate outdated patterns, deprecated APIs, and incorrect syntax.

sui-pilot solves this by bundling **695 documentation files** from five Mysten Labs sources directly into your Claude Code environment:

| Source        | Files | Topics                                                                  |
| ------------- | ----- | ----------------------------------------------------------------------- |
| **Sui**       | 339   | Blockchain, Move language, objects, transactions, SDKs, DeFi standards  |
| **Move Book** | 143   | Move language tutorial + reference: syntax, types, abilities, idioms    |
| **Walrus**    | 84    | Decentralized blob storage, Walrus Sites, HTTP API, node operations     |
| **Seal**      | 14    | Secrets management, encryption, key servers, access control policies    |
| **TS SDK**    | 115   | TypeScript SDK, dapp-kit, payment-kit, kiosk, React hooks, transactions |

The Move Book corpus also ships with `.move-book-docs/packages/` — Move source examples referenced from the prose via `file=` directives, available for follow-up reads but excluded from the indexed search corpus.

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

### Slash commands

| Command              | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `/sui-pilot`         | Doc-first entry point; routes to the sui-pilot agent |
| `/move-code-quality` | Move Book Code Quality Checklist compliance      |
| `/move-code-review`  | Security and architecture review                 |
| `/move-tests`        | Test generation best practices                   |
| `/move-pr-review`    | Multi-agent deep PR review (10 reviewers + consolidator) |
| `/oz-math`           | OpenZeppelin math library recommendations        |

Each command routes to a bundled skill of the same name; skills live under `skills/` and hold the actual behavior.

### Specialized Agent

The `sui-pilot-agent` enforces a doc-first workflow: consult documentation before writing code, use LSP for real-time validation.

---

## Installation

### From the marketplace (recommended)

sui-pilot is distributed via the [Contract Hero plugin marketplace](https://github.com/contract-hero/plugin-marketplace). Inside Claude Code:

```
/plugin marketplace add contract-hero/plugin-marketplace
/plugin install sui-pilot@contract-hero
```

Then restart Claude Code — MCP servers launch at session start.

The MCP server bundle ships prebuilt with the plugin, so end users do not need Node.js or pnpm installed.

### Migrating from the old `alilloig/sui-pilot` marketplace

Earlier releases were distributed from a self-hosted marketplace at `alilloig/sui-pilot`. That install path is **deprecated** — the catalog has moved into `contract-hero/plugin-marketplace`. To migrate:

```
/plugin uninstall sui-pilot@alilloig
/plugin marketplace remove alilloig
/plugin marketplace add contract-hero/plugin-marketplace
/plugin install sui-pilot@contract-hero
```

### Upgrading from a manual install

If you installed sui-pilot before the marketplace existed (git clone into `~/.claude/plugins/sui-pilot`), remove it first so the old copy doesn't shadow the marketplace install:

```bash
rm -rf ~/.claude/plugins/sui-pilot
```

### Requirements

| Component            | Version      | Notes                                                                  |
| -------------------- | ------------ | ---------------------------------------------------------------------- |
| suiup                | Latest       | `curl -sSfL https://raw.githubusercontent.com/Mystenlabs/suiup/main/install.sh \| sh` |
| sui + move-analyzer  | Same version | **Must match versions** — install both via suiup                       |
| Claude Code          | Latest       | Plugin host environment                                                |
| Node.js              | 18+          | Used to run the bundled MCP server (usually already present)           |

### Installing the Sui Toolchain

[suiup](https://docs.sui.io/guides/developer/getting-started/sui-install) is the official Sui version manager:

```bash
# Install suiup
curl -sSfL https://raw.githubusercontent.com/Mystenlabs/suiup/main/install.sh | sh
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
3. The agent reads `agents/sui-pilot-agent.md`, which contains the full pipe-delimited doc index between the `<!-- AGENTS-MD-START -->` and `<!-- AGENTS-MD-END -->` markers in the prompt body

The index is a compact, pipe-delimited file list that any AI agent can parse. It includes a warning: *"What you remember about Sui and Move is WRONG or OUTDATED — always search these docs first."*

---

## Keeping Docs Up to Date

### Why Local Docs?

LLMs have a knowledge cutoff. Sui Move evolves rapidly — new framework methods, changed APIs, deprecated patterns. An LLM trained 6 months ago will confidently generate code that no longer compiles or follows outdated conventions.

sui-pilot solves this by bundling documentation locally. The agent reads current docs before generating code, not stale training data.

### Why Sync from Upstream?

The docs are extracted directly from the official MystenLabs repositories — the same source that powers docs.sui.io, docs.walrus.site, and docs.seal.xyz. This ensures accuracy and consistency with what developers see in the official documentation.

| Source    | Repository                                                      | Doc Path(s)                       |
| --------- | --------------------------------------------------------------- | --------------------------------- |
| Sui       | [MystenLabs/sui](https://github.com/MystenLabs/sui)             | `docs/content/`                   |
| Move Book | [MystenLabs/move-book](https://github.com/MystenLabs/move-book) | `book/`, `reference/`, `packages/` |
| Walrus    | [MystenLabs/walrus](https://github.com/MystenLabs/walrus)       | `docs/content/`                   |
| Seal      | [MystenLabs/seal](https://github.com/MystenLabs/seal)           | `docs/content/`                   |
| TS SDK    | [MystenLabs/ts-sdks](https://github.com/MystenLabs/ts-sdks)     | `packages/docs/content/`          |

### Updating the Docs

Run these scripts periodically (e.g., monthly, or before a major project):

```bash
./sync-docs.sh           # Pull latest from MystenLabs repos
./generate-docs-index.sh # Rewrite the index block in agents/sui-pilot-agent.md
```

The sync script clones or pulls each upstream repo and copies the prose into the corresponding `.{source}-docs/` folder. Most sources contribute a single `docs/content/` tree; the Move Book contributes its `book/`, `reference/`, and `packages/` subtrees into `.move-book-docs/` (with `packages/` available on disk but excluded from the searchable index). The index script walks these directories and rewrites the block between `<!-- AGENTS-MD-START -->` and `<!-- AGENTS-MD-END -->` inside `agents/sui-pilot-agent.md` — a compact, pipe-delimited file list that ships as part of the agent's system prompt, so docs-first behavior works out of the box when the agent is invoked. A scheduled GitHub Actions workflow (`.github/workflows/refresh-docs.yml`) runs this pipeline weekly and opens a chore PR when upstream docs change.

---

## Plugin Structure

```
sui-pilot/
├── .claude-plugin/plugin.json   # Plugin manifest
├── agents/sui-pilot-agent.md    # Specialized Sui Move agent
├── skills/                      # Bundled skills (code-quality, code-review, tests, pr-review, oz-math)
├── mcp/move-lsp-mcp/            # MCP server wrapping move-analyzer
├── .sui-docs/                   # 339 Sui documentation files
├── .move-book-docs/             # 143 Move Book files (+ packages/ examples)
├── .walrus-docs/                # 84 Walrus documentation files
├── .seal-docs/                  # 14 Seal documentation files
└── .ts-sdk-docs/                # 115 TS SDK documentation files
```

---

## Troubleshooting

### MCP tools not appearing

Restart Claude Code completely (close and reopen). MCP servers launch at session start, not on plugin reload.

Verify the installed plugin's manifest declares the MCP server:
```bash
find ~/.claude/plugins/cache -path '*sui-pilot*/.claude-plugin/plugin.json' -exec cat {} +
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
find ~/.claude/plugins/cache -path '*sui-pilot*/mcp/move-lsp-mcp/dist/index.js'
```

If the file is missing, remove and reinstall the plugin from the marketplace:

```
/plugin uninstall sui-pilot@contract-hero
/plugin marketplace update contract-hero
/plugin install sui-pilot@contract-hero
```

---

## Limitations

sui-pilot is designed for Claude Code. Some capabilities are environment-specific:

| Feature | Claude Code | Other AI Agents |
|---------|-------------|-----------------|
| Bundled documentation | Yes | Yes (read the index block in `agents/sui-pilot-agent.md`) |
| MCP tools (diagnostics, hover, etc.) | Yes | No |
| Skills (/move-code-quality, etc.) | Yes | No |
| Specialized sui-pilot-agent | Yes | No |

**Other limitations:**

- **move-analyzer required separately**: LSP tools require `move-analyzer` to be installed via `suiup install move-analyzer`. The plugin does not bundle move-analyzer.
- **Version matching critical**: `sui` and `move-analyzer` must be the same version or LSP will crash.
- **macOS and Linux only**: Windows is not officially supported.
- **Documentation lag**: Bundled docs are point-in-time snapshots. Run `./sync-docs.sh` to update.

### Doc index is subagent-scoped by default

The pipe-delimited doc index lives inside `agents/sui-pilot-agent.md` and is loaded into context only when something invokes the `sui-pilot-agent` subagent. The bundled skills (`/sui-pilot`, `/move-pr-review`, `/move-code-review`, `/move-code-quality`, `/move-tests`, `/oz-math`) all dispatch the subagent, so they get the index for free.

**Free-form Claude Code chat does not.** If you ask a Sui/Move/Walrus/Seal question without invoking one of the sui-pilot skills, Claude falls back to its training memory — which is stale. You may see deprecated Move 1.x syntax, removed `SuiClient` imports, missing `network` parameters on the new TS SDK 2.0 clients, and similar drift.

**Workaround for users whose work is predominantly Sui-related:** add this line to your `~/.claude/CLAUDE.md` so the doc index loads in every session:

```markdown
@~/.claude/sui-pilot/agents/sui-pilot-agent.md
```

The trade-off is a fixed ≈16 KB of context per session (vs. zero when only skills are invoked). For occasional Sui work, prefer running the skills on demand instead.

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
- **Release history**: See [CHANGELOG.md](./CHANGELOG.md)

---

## License

MIT
