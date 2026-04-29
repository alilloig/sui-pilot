---
description: Run the sui-pilot health check (manifest, hooks, sui.md, agent preamble, MCP bundle)
---

Run the sui-pilot doctor script to verify the plugin install is healthy.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.ts" 2>&1
```

The doctor checks:
- `generated/skill-manifest.json` exists and parses
- Manifest skill set matches `skills/*/` on disk
- `agents/sui-pilot-agent.md` is within the slim-preamble byte budget (4 KB)
- `sui.md` exists and every `SKILL_TO_CHUNK` heading resolves
- All compiled hook scripts are present (warn if missing — needs `pnpm --dir hooks build`)
- `mcp/move-lsp-mcp/dist/index.js` exists (warn if missing)

Exit codes: `0` on pass (with warnings allowed), `1` on any failure.

If checks warn about missing builds, run:

```bash
pnpm --dir "${CLAUDE_PLUGIN_ROOT}/hooks" install && pnpm --dir "${CLAUDE_PLUGIN_ROOT}/hooks" build
node "${CLAUDE_PLUGIN_ROOT}/scripts/build-manifest.ts"
pnpm --dir "${CLAUDE_PLUGIN_ROOT}/mcp/move-lsp-mcp" build
```

Report the doctor output to the user.
