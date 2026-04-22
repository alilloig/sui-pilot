# Changelog

All notable changes to sui-pilot are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
