# sui-pilot for Dummies

A beginner's guide to making Claude Code into a competent Sui/Move developer that reads docs before generating code.

---

## 1. What Is This?

**sui-pilot is a Claude Code plugin** that fixes the single biggest problem with using LLMs for Sui/Move work: training data goes stale fast, and a model fresh out of pretraining will confidently generate Move 2023 syntax, deprecated framework calls, and APIs that no longer exist.

The plugin solves this by shipping the official Mysten Labs documentation — 695 files across five sources — directly into your Claude Code session, plus a slim always-loaded preamble that points the agent at the right corpus, plus a handful of procedural slash commands for the common workflows. It also wires `move-analyzer` (the official Move language server) into Claude through MCP, so the agent can run real compiler diagnostics instead of guessing whether code compiles.

After installing this guide, you can ask Claude to write Move 2024, audit a Sui contract for security, generate `test_scenario`-style unit tests, or do a multi-agent PR review — and the answers come back grounded in the bundled docs and verified against `move-analyzer`, not invented from training memory.

---

## 2. How It All Fits Together (Architecture)

```
  ┌──────────────────────┐
  │  Claude Code         │   (your editor — host process)
  └──────────┬───────────┘
             │ @-import loads the slim preamble
  ┌──────────▼─────────────────────────────────────┐
  │  sui-pilot plugin (${CLAUDE_PLUGIN_ROOT})      │
  │                                                │
  │  ├── agents/sui-pilot-agent.md  (always-loaded │
  │  │     ~2.9 KB doc-first directive)            │
  │  ├── commands/  (6 slash commands)             │
  │  ├── skills/    (5 procedural skills)          │
  │  └── .{sui,move-book,walrus,seal,ts-sdk}-docs/ │
  │      (695 documentation files, lazy-grepped)   │
  └──────────┬─────────────────────────────────────┘
             │ MCP (stdio)
  ┌──────────▼─────────────┐         ┌─────────────────────┐
  │  move-lsp MCP server   │ ──LSP──▶│  move-analyzer      │
  │  (bundled Node, ESM)   │         │  (suiup-installed)  │
  └────────────────────────┘         └─────────────────────┘
```

**Two things to know about how this fits together.** First, the always-loaded surface is tiny — only `sui-pilot-agent.md` (~2.9 KB) hits every session, and it tells the agent to `Glob`/`Grep` the bundled `.<source>-docs/` corpora before writing code. Second, the `move-lsp` MCP server is a separate process that bridges Claude to your locally-installed `move-analyzer` — `move_diagnostics` is the fast iteration loop you should reach for instead of `sui move build`. There is no matcher pipeline and no hooks: you type a slash command when you want a procedural skill, and the agent does the rest by reading docs.

---

## 3. Prerequisites

You need these on your machine before installing sui-pilot:

- **suiup** — Sui's official version manager.
  ```bash
  curl -fsSL https://sui.io/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"   # add to your shell profile
  ```
- **sui** and **move-analyzer** — installed via suiup, **with matching versions**.
  ```bash
  suiup install sui
  suiup install move-analyzer
  sui --version
  move-analyzer --version   # must match sui's version
  ```
- **Claude Code** — the host environment.
- **Node.js 18+** — used to run the bundled MCP server. Most systems already have it.
- **gh** (GitHub CLI) — only if you want to run `./sync-docs.sh` to refresh bundled docs from upstream. (Optional)

---

## 4. Installation

**From the marketplace (recommended).** Inside Claude Code:

```
/plugin marketplace add contract-hero/plugin-marketplace
/plugin install sui-pilot@contract-hero
```

Then **fully restart Claude Code** — close it and reopen it. MCP servers only launch at session start; a plugin reload is not enough.

The MCP server bundle and the compiled hook scripts ship prebuilt with the plugin, so end users do not need `pnpm`, `tsup`, or any build toolchain. You only need the toolchain if you want to develop the plugin itself.

> **Note:** If you previously installed sui-pilot from the old `alilloig/sui-pilot` marketplace, uninstall it first: `/plugin uninstall sui-pilot@alilloig` then `/plugin marketplace remove alilloig`. The catalog moved to `contract-hero/plugin-marketplace`.

---

## 5. First-Time Verification

Open Claude Code in any directory and try the LSP path — the most failure-prone piece:

```
> Check diagnostics for any .move file you have handy
```

If `move_diagnostics` returns compiler output, the MCP bridge is up and `move-analyzer` is reachable. If it errors with "move-analyzer not found" or "Max restarts exceeded", jump to § 8 (Troubleshooting).

For docs grounding, ask the agent something where stale training would betray itself:

```
> What's the Move 2024 syntax for module declarations?
```

The answer should match the bundled docs (a file-level `module x::y;` form, not the legacy curly-brace form). If the agent answers from stale training and doesn't reach for `.move-book-docs/`, your `~/.claude/CLAUDE.md` is probably missing the `@~/.claude/sui-pilot/agents/sui-pilot-agent.md` import — see § *Doc-first directive is subagent-scoped* in the README.

---

## 6. Day-to-Day Workflow

A realistic Move-development session with sui-pilot:

```bash
# Open Claude Code in your Move package directory
cd ~/projects/my-defi-pool

# Ask the agent to plan a feature. The slim doc-first preamble tells
# Claude to grep .sui-docs/ and .move-book-docs/ for current patterns
# before answering.
> Plan a shared Pool object with a deposit/withdraw API following
  the Move 2024 capability pattern.

# Implement.
> Implement the deposit function with proper UID handling.

# Get real compiler feedback — faster than re-running `sui move build`.
> Check diagnostics for sources/pool.move

# Quality pass.
> /move-code-quality

# Security pass — substantial changes only.
> /move-code-review

# Generate tests.
> /move-tests

# Before opening a PR — multi-agent deep review. Ten parallel reviewers
# + one consolidator produce a high-confidence Markdown report.
> /move-pr-review

# Math-heavy DeFi code? Audit it for safer arithmetic.
> /oz-math
```

The slash commands are the entry points. The doc-first preamble is what keeps the agent reading current docs instead of generating from stale training memory.

---

## 7. Updating Bundled Docs

The bundled `.{sui,move-book,walrus,seal,ts-sdk}-docs/` corpora are snapshots of the upstream Mysten Labs repositories at sync time. They go stale; refresh them periodically (monthly is typical, or before starting a major project):

```bash
cd /path/to/sui-pilot   # or wherever the plugin is installed
./sync-docs.sh
```

Behind the scenes, the script downloads tarballs from `MystenLabs/{sui,walrus,seal,ts-sdks,move-book}` via `gh api`, extracts the prose subtrees, strips binaries (PNG/JPEG/SVG — useless for AI text consumption), and replaces the `.<source>-docs/` directories. It writes a fresh `.last-sync` JSON file with timestamps and file counts.

If you maintain this repo yourself, a scheduled GitHub Actions workflow at `.github/workflows/refresh-docs.yml` runs the same pipeline weekly and opens a chore PR when upstream docs change.

The agent navigates the corpora directly with `Glob` and `Grep`, routed by the small topic table at the top of `agents/sui-pilot-agent.md`. There is nothing to regenerate after `sync-docs.sh`.

---

## 8. Troubleshooting

**MCP tools (`move_diagnostics`, `move_hover`, etc.) don't appear.** Restart Claude Code completely — close and reopen, not reload. MCP servers launch only at session start. Verify the manifest with:
```bash
find ~/.claude/plugins/cache -path '*sui-pilot*/.claude-plugin/plugin.json' -exec cat {} +
```

**LSP returns "move-analyzer not found".** Install via suiup:
```bash
suiup install move-analyzer
which move-analyzer   # should resolve to ~/.local/bin/move-analyzer
```
If it resolves to `~/.cargo/bin/move-analyzer`, an old cargo install is shadowing suiup — rename it: `mv ~/.cargo/bin/move-analyzer ~/.cargo/bin/move-analyzer.bak`.

**LSP crashes with "Max restarts exceeded".** Version mismatch between `sui` and `move-analyzer`. Check both:
```bash
sui --version
move-analyzer --version
```
They must match. Fix with `suiup update sui && suiup update move-analyzer`.

**The agent ignores the bundled docs and falls back to training knowledge.** This usually means the slim doc-first preamble isn't loaded into the session — Claude Code only loads `agents/sui-pilot-agent.md` if you `@`-import it from your global `~/.claude/CLAUDE.md` (see § *Doc-first directive is subagent-scoped* in the README) or invoke a slash command that routes through the `sui-pilot-agent` subagent.

---

## Appendix A: All Slash Commands

| Command               | Description                                                                     |
| --------------------- | ------------------------------------------------------------------------------- |
| `/sui-pilot`          | Doc-first entry point — routes to the specialized `sui-pilot-agent` subagent    |
| `/move-code-quality`  | Move Book Code Quality Checklist compliance (Move 2024 idioms, syntax, style)   |
| `/move-code-review`   | Security and architecture review of Move code (40 checks across 6 categories)   |
| `/move-tests`         | Generate or improve `test_scenario`-style unit tests for a Move package         |
| `/move-pr-review`     | Multi-agent deep PR review — 10 parallel reviewers + 1 consolidator             |
| `/oz-math`            | Audit arithmetic and recommend OpenZeppelin math contracts where helpful        |

Each command routes to a bundled skill of the same name. Skills hold the actual procedural behavior; commands are thin wrappers that invoke the right skill.

## Appendix B: Why There Is No Matcher

Earlier work on this branch adopted a hook-based skill-matcher pattern modeled on Vercel's own Claude Code plugin (skill scoring, prompt signals, `sui.md` chunk injection, manifest, doctor). It's a well-engineered pattern that solves a real problem in plugins with many overlapping skills. sui-pilot ships 5 explicitly-named skills, so there's nothing for a matcher to disambiguate — and the 15-task eval suite under `evals/` confirmed dead-heat parity with no matcher. The simpler shape ships. Full rationale in [`NOTES.md`](NOTES.md); the numbers in [`evals/BASELINE.md`](evals/BASELINE.md).

## Appendix C: Important Files

| File                              | Description                                                                 |
| --------------------------------- | --------------------------------------------------------------------------- |
| `.claude-plugin/plugin.json`      | Plugin manifest — registers the `move-lsp` MCP server                       |
| `agents/sui-pilot-agent.md`       | The slim doc-first directive (always-loaded via `@`-import; ~2.9 KB)        |
| `commands/`                       | Slash command definitions (6 files)                                         |
| `skills/<name>/SKILL.md`          | Skill body (5 skills)                                                       |
| `mcp/move-lsp-mcp/dist/index.js`  | Compiled MCP bundle (committed; ~480 KB)                                    |
| `sync-docs.sh`                    | Pulls the 5 doc corpora from upstream Mysten Labs repos                     |
| `evals/`                          | 15-task A/B harness — `run-comparison.sh`, `tasks.json`, fixtures, baseline |
| `NOTES.md`                   | Branch narrative: why we tried a matcher pattern from a sibling plugin, what the evals showed, how to extend the eval framework |

## Appendix D: Glossary

- **MCP** — Model Context Protocol. Anthropic's stdio-based protocol for plugging external tools into an LLM. The `move-lsp` MCP server is what lets Claude call `move_diagnostics` like any other tool.
- **`move-analyzer`** — The official Move language server (LSP). The MCP server is a thin bridge that translates MCP tool calls into LSP requests.
- **Skill** — A bundled procedural guide under `skills/<name>/SKILL.md`. The Markdown body is what the agent reads when the slash command fires.
- **Slash command** — A user-typed shortcut like `/move-code-quality` that invokes a skill.
- **Doc-first directive** — The opening rule in `agents/sui-pilot-agent.md` that tells the agent to grep `.<source>-docs/` *before* writing code, because training data on Sui is stale.
- **suiup** — Sui's official version manager. Installs `sui` and `move-analyzer` as a matched pair.
- **Walrus** — Mysten Labs' decentralized blob-storage protocol on Sui.
- **Seal** — Mysten Labs' threshold-encryption / decentralized key-management protocol on Sui.
