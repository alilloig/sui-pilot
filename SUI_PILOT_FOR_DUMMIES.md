# sui-pilot for Dummies

A beginner's guide to making Claude Code into a competent Sui/Move developer that reads docs before generating code.

---

## 1. What Is This?

**sui-pilot is a Claude Code plugin** that fixes the single biggest problem with using LLMs for Sui/Move work: training data goes stale fast, and a model fresh out of pretraining will confidently generate Move 2023 syntax, deprecated framework calls, and APIs that no longer exist.

The plugin solves this by shipping the official Mysten Labs documentation — 695 files across five sources — directly into your Claude Code session, plus a thin matcher pipeline that injects the *right* docs at the *right* moment based on what you're doing. It also wires `move-analyzer` (the official Move language server) into Claude through MCP, so the agent can run real compiler diagnostics instead of guessing whether code compiles.

After installing this guide, you can ask Claude to write Move 2024, audit a Sui contract for security, generate `test_scenario`-style unit tests, or do a multi-agent PR review — and the answers come back grounded in the bundled docs and verified against `move-analyzer`, not invented from training memory.

---

## 2. How It All Fits Together (Architecture)

```
  ┌──────────────────────┐
  │  Claude Code         │   (your editor — host process)
  └──────────┬───────────┘
             │ hook events (SessionStart, PreToolUse,
             │ UserPromptSubmit, SessionEnd)
  ┌──────────▼─────────────────────────────────────┐
  │  sui-pilot plugin (${CLAUDE_PLUGIN_ROOT})      │
  │                                                │
  │  ├── agents/sui-pilot-agent.md  (always-loaded │
  │  │     ~2.9 KB doc-first directive)            │
  │  ├── commands/  (7 slash commands)             │
  │  ├── skills/    (5 procedural skills)          │
  │  ├── hooks/*.mjs  (the matcher pipeline)       │
  │  ├── sui.md     (on-demand chunked graph)      │
  │  ├── generated/skill-manifest.json             │
  │  └── .{sui,move-book,walrus,seal,ts-sdk}-docs/ │
  │      (695 documentation files, lazy-grepped)   │
  └──────────┬─────────────────────────────────────┘
             │ MCP (stdio)
  ┌──────────▼─────────────┐         ┌─────────────────────┐
  │  move-lsp MCP server   │ ──LSP──▶│  move-analyzer      │
  │  (bundled Node, ESM)   │         │  (suiup-installed)  │
  └────────────────────────┘         └─────────────────────┘
```

**Three things to know about how this fits together.** First, the *always-loaded* surface is tiny — only `sui-pilot-agent.md` (~2.9 KB) hits every session; everything else loads on demand. Second, the hook pipeline is what makes the plugin feel smart: when you Edit a `*.move` file, a PreToolUse hook injects the right skill body plus a chunk of `sui.md`; when you type "review this for security" the same pipeline scores your prompt and injects `move-code-review`. Third, the `move-lsp` MCP server is a separate process that bridges Claude to your locally-installed `move-analyzer` — `move_diagnostics` is the fast iteration loop you should reach for instead of `sui move build`.

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

Run the doctor to confirm the install is healthy:

```
/sui-pilot-doctor
```

Behind the scenes, the doctor command runs `bun run scripts/doctor.ts` which performs six checks:

1. **Manifest** — `generated/skill-manifest.json` exists and parses.
2. **Manifest/disk parity** — every `skills/*/SKILL.md` is in the manifest and vice versa.
3. **Agent preamble** — `agents/sui-pilot-agent.md` is under the 4 KB byte budget.
4. **sui.md graph** — every heading the chunk extractor maps to actually exists.
5. **Hook scripts** — all six compiled `.mjs` hooks are present.
6. **move-lsp MCP** — the bundled `mcp/move-lsp-mcp/dist/index.js` is on disk.

A green run looks like:

```
✓ manifest          — parses; 5 skills
✓ manifest/disk parity — 5 skills match
✓ agent preamble    — 2859 / 4000 bytes
✓ sui.md graph      — all 5 skill chunks resolve
✓ hook scripts      — all 6 compiled
✓ move-lsp MCP      — bundle present (480972 bytes)
```

If any check fails or warns, the doctor's output tells you exactly which `pnpm`/`bun` command to run to recover. Most problems are fixed by a clean reinstall from the marketplace.

---

## 6. Day-to-Day Workflow

A realistic Move-development session with sui-pilot:

```bash
# Open Claude Code in your Move package directory
cd ~/projects/my-defi-pool

# Ask the agent to plan a feature — sui-pilot routes through the
# specialized sui-pilot-agent and grounds the answer in the bundled
# .sui-docs/ and .move-book-docs/ corpora.
> Plan a shared Pool object with a deposit/withdraw API following
  the Move 2024 capability pattern.

# Edit the file. The PreToolUse hook fires automatically and injects
# the move-code-quality skill body + the "Move type system & abilities"
# chunk from sui.md, so the agent's edits respect Move 2024 idioms.
> Implement the deposit function with proper UID handling.

# Get real compiler feedback — faster than re-running `sui move build`.
> Check diagnostics for sources/pool.move

# Mid-task: ask for a security review. The UserPromptSubmit hook
# scores the phrase "security review" highly and injects move-code-review
# with the "Sui object model" chunk.
> Review this for security issues — focus on the shared-object access
  control.

# Generate tests. Triggers move-tests skill.
> Write tests for the deposit/withdraw flow.

# Before opening a PR — multi-agent deep review. Ten parallel reviewers
# + one consolidator produce a high-confidence Markdown report.
> /move-pr-review

# Math-heavy DeFi code? Audit it for safer arithmetic.
> /oz-math
```

You don't need to remember which slash command to use for what — the matcher pipeline routes most requests automatically based on what you say and what files you touch. The slash commands are the manual override.

---

## 7. Updating Bundled Docs

The bundled `.{sui,move-book,walrus,seal,ts-sdk}-docs/` corpora are snapshots of the upstream Mysten Labs repositories at sync time. They go stale; refresh them periodically (monthly is typical, or before starting a major project):

```bash
cd /path/to/sui-pilot   # or wherever the plugin is installed
./sync-docs.sh
```

Behind the scenes, the script downloads tarballs from `MystenLabs/{sui,walrus,seal,ts-sdks,move-book}` via `gh api`, extracts the prose subtrees, strips binaries (PNG/JPEG/SVG — useless for AI text consumption), and replaces the `.<source>-docs/` directories. It writes a fresh `.last-sync` JSON file with timestamps and file counts.

If you maintain this repo yourself, a scheduled GitHub Actions workflow at `.github/workflows/refresh-docs.yml` runs the same pipeline weekly and opens a chore PR when upstream docs change.

> **Note:** v2 of sui-pilot deliberately removed the precomputed pipe-delimited file index that v1 used to maintain. The agent now navigates the corpora directly with `Glob` and `Grep`, routed by the small topic table at the top of `agents/sui-pilot-agent.md`. There is nothing to regenerate after `sync-docs.sh`.

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

**`/sui-pilot-doctor` reports a missing manifest or compiled hooks.** The marketplace install is corrupted — reinstall:
```
/plugin uninstall sui-pilot@contract-hero
/plugin install sui-pilot@contract-hero
```
Then fully restart Claude Code.

**The agent ignores the bundled docs and falls back to training knowledge.** This usually means the agent didn't see the SessionStart injection (the doc-first directive in `sui-session.md`). Run `/sui-pilot-doctor` to verify the hook scripts exist; check that `CLAUDE_PROJECT_ROOT` is set in your environment if you launched Claude Code from a non-standard path.

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
| `/sui-pilot-doctor`   | Run the install-health check (6 checks); reports `pnpm`/`bun` recovery commands |

Each command routes to a bundled skill of the same name. Skills hold the actual procedural behavior; commands are thin wrappers that invoke the right skill.

## Appendix B: How sui-pilot Decides What to Inject

The matcher pipeline runs at four hook events and uses three signal types per skill. Reference for understanding *why* the agent suddenly picks up a skill mid-session.

**Hook events** (`hooks/hooks.json`):

| Event              | When it fires                                              | What it does                                                                  |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `SessionStart`     | `startup`, `resume`, `clear`, `compact`                    | Profiler scans the project for Move/Sui markers; injects `sui-session.md`     |
| `PreToolUse`       | `Read`, `Edit`, `Write`, `MultiEdit`, `Bash`, `mcp__sui-pilot__move-lsp__*` | Matches skills against tool inputs (file paths, bash commands, imports)       |
| `UserPromptSubmit` | Every user message                                         | Scores the prompt against each skill's `promptSignals`                        |
| `SessionEnd`       | Session end                                                | Cleans up `/tmp/sui-pilot-<sessionId>-*` dedup files                          |

**Per-skill signals** (in `skills/<name>/SKILL.md` frontmatter, compiled into `generated/skill-manifest.json`):

| Field            | Purpose                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| `priority`       | Base priority (1–10). Higher wins ties when multiple skills match.            |
| `pathPatterns`   | Glob patterns matched against tool input file paths (e.g. `**/*.move`)        |
| `bashPatterns`   | Regex matched against `Bash` tool inputs (e.g. `\bsui\s+move\s+test\b`)       |
| `importPatterns` | Regex matched against TypeScript/JavaScript imports (e.g. `@mysten/sui`)      |
| `promptSignals`  | Scoring rules: `phrases` +6 each, `allOf` +4, `anyOf` +1×2 cap, `noneOf`=−∞   |

**Boosts that affect the score:**

- The SessionStart profiler sets `SUI_PILOT_LIKELY_SKILLS` based on detected markers (`Move.toml`, `@mysten/*` deps). Skills in that list get **+5 priority**.
- When any `mcp__sui-pilot__move-lsp__*` tool fires, the same +5 boost is applied to `move-code-quality`, `move-code-review`, and `move-tests` for the rest of the session.

**Byte budgets (overridable via env):**

| Env var                              | Default | What it caps                                  |
| ------------------------------------ | ------- | --------------------------------------------- |
| `SUI_PILOT_INJECTION_BUDGET`         | 18000   | Total bytes injected per `PreToolUse` event   |
| `SUI_PILOT_PROMPT_INJECTION_BUDGET`  | 8000    | Total bytes injected per `UserPromptSubmit`   |
| (constant in `sui-context.mts`)      | 5000    | Per-chunk extraction budget from `sui.md`     |

**Dedup:** `/tmp/sui-pilot-<sessionId>-seen-skills.d/` and `seen-context-chunks.d/` track what's been injected this session. The same skill body is never injected twice.

## Appendix C: How It Boots (Under the Hood)

For the curious. The order of operations from `/plugin install` to your first prompt:

1. **Plugin install** copies the entire `sui-pilot/` tree into `~/.claude/plugins/cache/sui-pilot/`.
2. **Claude Code start** reads `.claude-plugin/plugin.json`, sees the `mcpServers.move-lsp` entry, and spawns `node ${CLAUDE_PLUGIN_ROOT}/mcp/move-lsp-mcp/dist/index.js` as a child process. The MCP server exposes 4 tools (`move_diagnostics`, `move_hover`, `move_completions`, `move_goto_definition`) over stdio.
3. **Hook discovery** — Claude Code reads `hooks/hooks.json` and registers the 6 hook scripts at the 4 hook events.
4. **First SessionStart fires.** Three hooks run in order: `session-start-seen-skills.mjs` (clears `/tmp` dedup state), `session-start-profiler.mjs` (scans `process.cwd()` for `Move.toml`, `*.move`, `@mysten/*` deps; sets `SUI_PILOT_LIKELY_SKILLS` and `SUI_PILOT_GREENFIELD` via `setSessionEnv`), `inject-sui-context.mjs` (writes ~600 B of doc-first directive from `sui-session.md` to additional context).
5. **`agents/sui-pilot-agent.md` is loaded** by Claude Code's global `@`-import mechanism (~2.9 KB). This is the *only* always-loaded preamble.
6. **First user prompt arrives.** `user-prompt-submit-skill-inject.mjs` reads the manifest, scores the prompt against every skill's `promptSignals`, applies boosts from `SUI_PILOT_LIKELY_SKILLS`, picks the top 2 skills under the 8 KB budget, and injects them.
7. **First tool call fires** (typically a `Read` of the user's file). `pretooluse-skill-inject.mjs` runs the path/bash/import matcher pipeline, picks the top 3 skills under the 18 KB budget, and injects them along with a chunk extracted from `sui.md`.
8. **Each subsequent tool call** repeats step 7 with dedup applied — a skill that was injected this session won't be re-injected unless the session is `clear`ed or `compact`ed.

## Appendix D: Important Files

| File                                          | Description                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `.claude-plugin/plugin.json`                  | Plugin manifest — registers the `move-lsp` MCP server                       |
| `agents/sui-pilot-agent.md`                   | The slim doc-first directive (always-loaded; ~2.9 KB)                       |
| `sui.md`                                      | Hand-curated relational graph; chunks extracted on demand by skill match    |
| `sui-session.md`                              | ~600 B SessionStart payload — the doc-first warning the agent sees on boot  |
| `commands/`                                   | Slash command definitions (7 files)                                         |
| `skills/<name>/SKILL.md`                      | Skill body + matcher frontmatter (5 skills)                                 |
| `hooks/hooks.json`                            | Hook event registration                                                     |
| `hooks/src/*.mts`                             | Source for the matcher pipeline (TypeScript)                                |
| `hooks/*.mjs`                                 | Compiled hook scripts (committed; consumers don't build)                    |
| `hooks/src/sui-context.mts`                   | The `SKILL_TO_CHUNK` map driving `sui.md` chunk extraction                  |
| `hooks/src/session-start-profiler.mts`        | Move/Sui marker detection that drives `SUI_PILOT_LIKELY_SKILLS`             |
| `mcp/move-lsp-mcp/dist/index.js`              | Compiled MCP bundle (committed; ~480 KB)                                    |
| `scripts/build-manifest.ts`                   | Compiles `skills/*/SKILL.md` frontmatter into `generated/skill-manifest.json` |
| `scripts/doctor.ts`                           | The 6-check install-health script behind `/sui-pilot-doctor`                |
| `sync-docs.sh`                                | Pulls the 5 doc corpora from upstream Mysten Labs repos                     |
| `generated/skill-manifest.json`               | Pre-compiled regex sources + skill metadata (committed)                     |
| `docs/VERSION.json`                           | Sync timestamp + revision pin                                               |

## Appendix E: Glossary

- **MCP** — Model Context Protocol. Anthropic's stdio-based protocol for plugging external tools into an LLM. The `move-lsp` MCP server is what lets Claude call `move_diagnostics` like any other tool.
- **`move-analyzer`** — The official Move language server (LSP). The MCP server is a thin bridge that translates MCP tool calls into LSP requests.
- **Skill** — A bundled procedural guide under `skills/<name>/SKILL.md`. Each skill has matcher frontmatter and a Markdown body the agent reads when the skill matches.
- **Slash command** — A user-typed shortcut like `/move-code-quality` that invokes a skill.
- **Manifest** — `generated/skill-manifest.json`. Pre-compiled regex sources for every skill's path/bash/import patterns. Built by `scripts/build-manifest.ts`.
- **Doctor** — `scripts/doctor.ts`. The 6-check install-health script.
- **Profiler** — `hooks/src/session-start-profiler.mts`. Scans the project at SessionStart to set `SUI_PILOT_LIKELY_SKILLS` so the matcher gives boosted priority to skills that match the project shape.
- **sui.md** — The hand-curated ecosystem graph at the plugin root. Sectioned by topic; chunks are extracted by heading and injected per matched skill.
- **Doc-first directive** — The opening rule in `agents/sui-pilot-agent.md` that tells the agent to grep `.<source>-docs/` *before* writing code, because training data on Sui is stale.
- **suiup** — Sui's official version manager. Installs `sui` and `move-analyzer` as a matched pair.
- **Walrus** — Mysten Labs' decentralized blob-storage protocol on Sui.
- **Seal** — Mysten Labs' threshold-encryption / decentralized key-management protocol on Sui.
