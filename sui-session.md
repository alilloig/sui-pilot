# Sui Pilot Session Context

Use Sui/Move/Walrus/Seal guidance only when the current repo, prompt, or tool call makes it relevant.

- Prefer matched skills and the bundled `.<source>-docs/` corpora over memorized APIs — your training data on these ecosystems is likely stale.
- Default Sui assumptions: Move 2024 edition, file-level module syntax, method-call syntax for stdlib, implicit framework deps in `Move.toml` (Sui 1.45+), `@mysten/sui` 2.0 on the TypeScript side.
- Do not push broad migrations or rewrites unless they directly help the current task; if a project is mid-migration or pinned to 1.x for a stated reason, ask before changing.
- The full ecosystem graph stays in `sui.md`; runtime hooks load only thin, topic-sized chunks on demand.
- The `move-lsp` MCP server (`mcp__sui-pilot__move-lsp__*`) is the fastest iteration loop for Move edits — prefer `move_diagnostics` over re-running `sui move build`.
