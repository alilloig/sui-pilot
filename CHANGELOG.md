# Changelog

All notable changes to sui-pilot are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`/move-pr-review` skill** — multi-agent deep PR review for Sui Move packages. Orchestrates 10 parallel `sui-pilot:sui-pilot-agent` reviewers + 1 consolidator from the main Claude Code session. Each reviewer independently invokes `/move-code-review` and `/move-code-quality`, cross-checks integration boundaries against upstream Move deps, and emits strict-schema JSON findings. The consolidator clusters, verifies high-severity claims against source code, and writes an evidence-backed Markdown review with `## Test & coverage plan` and `## Build reproducibility & ops` sections kept separate from the code-level severity body.
- **`commands/move-pr-review.md`** — slash-command routing for the new skill.
- **`skills/move-pr-review/scripts/`** — Node.js + bash + jq utilities: `consolidate.js` (cluster by file + line-range + title similarity), `validate_schema.sh` (per-reviewer strict schema check), `coverage_matrix.sh` (file × reviewer coverage with < 50% floor for leader backfill).
- **`skills/move-pr-review/evals/`** — complete skill-creation walkthrough including iter-1 artifacts (simulated 5 reviewers; surfaced the main-session-orchestration and plugin-registration blockers), iter-2 artifacts (real 10 reviewers; 9/9 assertions pass; 2 HIGH code findings), and a didactic README explaining the full evaluation loop for anyone writing or iterating on a multi-agent skill.

### Notes

- The skill MUST be invoked from the main Claude Code session. Spawned subagents lack the `Task` tool and can't dispatch the 11 sub-subagents this skill depends on; the skill halts with a clear message if `Task` is unavailable.
- First real end-to-end run is captured in `skills/move-pr-review/evals/iteration-2/`: 292 raw findings → 64 clusters → 2 HIGH / 7 MEDIUM / 13 LOW / 8 INFO / 4 rejected, ~26 min wall clock, ~1.45M tokens across all 11 agents.

## [0.1.0] — 2026-04-22

First marketplace-installable release. Install via:

```
/plugin marketplace add alilloig/sui-pilot
/plugin install sui-pilot@alilloig
```

### Added

- Self-hosted plugin marketplace at `.claude-plugin/marketplace.json` (`alilloig` marketplace, one plugin `sui-pilot` sourced from the repo root).
- Prebundled `move-lsp` MCP server (esbuild, minified ESM, ~470 KB) committed at `mcp/move-lsp-mcp/dist/index.js` so marketplace installs work with no post-install build step.
- Bundled documentation for the Sui, Walrus, Seal, and TypeScript SDK ecosystems (548 files total).
- Five slash commands: `/sui-pilot`, `/move-code-quality`, `/move-code-review`, `/move-tests`, `/oz-math`.
- `sui-pilot-agent` doc-first subagent.
- CI drift-check and bundle-size budget (600 KB ceiling) on the committed MCP bundle.

### Changed

- `.claude-plugin/plugin.json` no longer declares `commands`/`skills`/`agents` explicitly — relies on Claude Code auto-discovery from the standard `commands/`, `skills/`, `agents/` directories at the plugin root.
- Installation instructions rewritten around the marketplace flow; Node.js and pnpm are no longer end-user prerequisites.

### Removed

- `scripts/setup.sh` — superseded by the prebundled marketplace install.
- Root-level `.mcp.json` — redundant with `plugin.json`'s `mcpServers` declaration.

### Supersedes

- [#8](https://github.com/alilloig/sui-pilot/pull/8) by @nikos-terzo — same structural direction (auto-discovery + marketplace manifest), but this release additionally fixes the `dist/`-is-gitignored bug, removes the duplicate `.mcp.json`, uses `alilloig`-owned metadata, and moves the plugin version onto the marketplace entry per docs guidance for relative-path plugins.
