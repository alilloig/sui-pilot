# Changelog

All notable changes to sui-pilot are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Move Book is now indexed as a fifth doc corpus.** [`MystenLabs/move-book`](https://github.com/MystenLabs/move-book) (the canonical Move-language tutorial + language reference) is pulled into `.move-book-docs/` alongside the existing `.sui-docs/`, `.walrus-docs/`, `.seal-docs/`, and `.ts-sdk-docs/`. The new `[Move Book Docs Index]` section appears between Sui and Seal in `agents/sui-pilot-agent.md`, giving subagents direct routing for Move language questions (syntax, types, abilities, idioms) instead of forcing them through Sui-specific docs. Total bundled doc files: ~695 (was 548).
- **`sync_repo_multi` helper in `sync-docs.sh`** — handles repos with multiple upstream subtrees in a single tarball fetch (the Move Book ships `book/`, `reference/`, and `packages/` as separate top-level dirs). Existing single-path corpora keep using `sync_repo` unchanged. A post-extract cleanup drops empty top-level directories that bsdtar materializes for archive entries that don't match the include filter.
- **`generate_index()` accepts an optional `skip_subdir` argument** to exclude subtrees from the generated index. Used by `.move-book-docs/packages/`: the `.move` source examples are co-located on disk for follow-up reads (so `file=` directives in the prose remain resolvable) but are excluded from the searchable pipe-delimited index, keeping the index pure prose.

### Changed

- **`scripts/sync-sui-pilot-docs.sh`, `scripts/verify.sh`, `.github/workflows/ci.yml`, `.github/workflows/refresh-docs.yml`** all extended to handle `.move-book-docs/` and the new `[Move Book Docs Index]` section header. CI assertions now check the indexed doc-source set (Sui, Move Book, Walrus, Seal, TS SDK) rather than the previous "four-ecosystem" set.
- **README, CLAUDE, and the six skill files** (`move-code-quality`, `move-code-review`, `move-tests`, `move-pr-review` SKILL.md + reviewer/consolidator prompts) updated to enumerate the fifth corpus in their doc-first prose. CLAUDE's routing table heading renamed from "Ecosystem" to a more accurate framing since Move Book is a language reference rather than a protocol layer.

- **Doc index relocated into the agent prompt.** The pipe-delimited documentation index (previously at `/AGENTS.md`) now lives inside `agents/sui-pilot-agent.md`, between `<!-- AGENTS-MD-START -->` and `<!-- AGENTS-MD-END -->` markers. Because the agent's system prompt is auto-loaded when the agent is invoked, docs-first guidance now works with zero setup for plugin consumers — no `@AGENTS.md` import in a user CLAUDE.md is required. `generate-docs-index.sh` was rewritten to rewrite only the block between the markers, preserving frontmatter and prose.
- **`/CLAUDE.md` dropped the `@AGENTS.md` import** and the Usage section now points to the embedded index in the agent file.
- **`scripts/sync-sui-pilot-docs.sh`** now copies `agents/sui-pilot-agent.md` (the new canonical index home) and `.ts-sdk-docs/` into the `docs/` bundle; `AGENTS.md` is no longer required.
- **`scripts/verify.sh`** now verifies `.ts-sdk-docs/` and checks the agent file for the index markers + four ecosystem section headers instead of the old root `AGENTS.md` existence check.
- **CI (`.github/workflows/ci.yml`)** replaced the `AGENTS.md` existence check with a markered-index + four-ecosystem-header check, and adds a drift-gate that runs `./generate-docs-index.sh` and fails on any diff against the committed agent file.

### Added

- **`.github/workflows/refresh-docs.yml`** — scheduled weekly (Mon 06:00 UTC) + `workflow_dispatch` workflow that runs `sync-docs.sh` → `generate-docs-index.sh` → `scripts/sync-sui-pilot-docs.sh` and opens a `chore(docs): refresh upstream docs` PR via `peter-evans/create-pull-request` when the bundled docs drift from upstream.
- **`/move-pr-review` skill** — multi-agent deep PR review for Sui Move packages. Orchestrates 10 parallel `sui-pilot:sui-pilot-agent` reviewers + 1 consolidator from the main Claude Code session. Each reviewer independently invokes `/move-code-review` and `/move-code-quality`, cross-checks integration boundaries against upstream Move deps, and emits strict-schema JSON findings. The consolidator clusters, verifies high-severity claims against source code, and writes an evidence-backed Markdown review with `## Test & coverage plan` and `## Build reproducibility & ops` sections kept separate from the code-level severity body.
- **`commands/move-pr-review.md`** — slash-command routing for the new skill.
- **`skills/move-pr-review/scripts/`** — Node.js + bash + jq utilities: `consolidate.js` (cluster by file + line-range + title similarity), `validate_schema.sh` (per-reviewer strict schema check), `coverage_matrix.sh` (file × reviewer coverage with < 50% floor for leader backfill).
- **`skills/move-pr-review/evals/`** — complete skill-creation walkthrough including iter-1 artifacts (simulated 5 reviewers; surfaced the main-session-orchestration and plugin-registration blockers), iter-2 artifacts (real 10 reviewers; 9/9 assertions pass; 2 HIGH code findings), and a didactic README explaining the full evaluation loop for anyone writing or iterating on a multi-agent skill.

### Fixed

- **TypeScript SDK ecosystem was systemically under-referenced** across user-facing surfaces even though the core pipelines already handled it. The following files now enumerate all four ecosystems (Sui, Walrus, Seal, TS SDK) consistently: `llms.txt`, `commands/sui-pilot.md`, `agents/sui-pilot-agent.md` (Doc-First Rule body), `skills/move-code-quality/SKILL.md`, `skills/move-code-review/SKILL.md`, `skills/move-tests/SKILL.md`, `scripts/sync-sui-pilot-docs.sh`, `scripts/verify.sh`, `skills/move-pr-review/references/reviewer_prompt.md`, and the two `.claude-plugin/fixtures/*-workflow-transcript.md` files.
- **`scripts/sync-sui-pilot-docs.sh` VERSION.json schema aligned with the MCP server.** The script previously wrote `{sourceCommit, syncTimestamp, suiFrameworkVersion}`, but `mcp/move-lsp-mcp/src/version.ts` expects `{pluginVersion, suiPilotRevision, syncTimestamp}`. With the refresh workflow about to run this script on a schedule, the two had to agree — the script now emits the schema the MCP version check consumes, deriving `pluginVersion` from `.claude-plugin/marketplace.json` and `suiPilotRevision` from the short git SHA.
- **`docs/` bundle is now properly gitignored** (only `docs/VERSION.json` stays tracked). The refresh workflow regenerates the bundle on demand; local runs of `scripts/sync-sui-pilot-docs.sh` no longer pollute `git status`.

### Removed

- **Root `/AGENTS.md`.** External AI consumers that previously read this file should now read `agents/sui-pilot-agent.md`; the same pipe-delimited index is embedded there between the `AGENTS-MD-START` / `AGENTS-MD-END` markers. README's "For Other AI Agents" section was updated to reflect this.

### Notes

- The `/move-pr-review` skill MUST be invoked from the main Claude Code session. Spawned subagents lack the `Task` tool and can't dispatch the 11 sub-subagents this skill depends on; the skill halts with a clear message if `Task` is unavailable.
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
