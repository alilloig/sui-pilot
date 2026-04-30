# Research notes — sui-pilot v2 (graph-port branch)

This file exists so a fresh Claude Code session can pick up the v2 work without re-running the research. The full plan is at `DESIGN_V2.md` in this worktree (mirror of `~/.claude/plans/do-a-deep-research-elegant-puzzle.md`).

## How to resume

In a fresh session inside this worktree:

1. Read `DESIGN_V2.md` — full research report + execution plan.
2. Read this file for one-page context recovery.
3. Start with **Layer 1** (slim the always-loaded preamble) — lowest-risk highest-payoff.

## Why this branch exists

User intuition was that `vercel.md` (in `vercel-plugin`) had deprecated the AGENTS.md pattern from Vercel's January 2026 blog post, driven by Claude Code's 1M context window. Goal: port the new approach to sui-pilot for a state-of-the-art revision.

## Verdict from the research

**Hypothesis FALSE — but research surfaced the real state-of-the-art.**

- Pipe-delimited indexing wasn't deprecated by 1M context. It was deprecated by **direct doc co-location** — Next.js 16.2 ships docs inside `node_modules/next/dist/docs/` and AGENTS.md collapses to a one-line pointer.
- `vercel.md` is **not** AGENTS.md's successor. It's a **complementary plugin-internal layer** ("Ecosystem graph") that Vercel ships alongside AGENTS.md.
- 1M context GA'd Mar 13, 2026 (Anthropic) — verified, but **not load-bearing** for the design. vercel-plugin still enforces 18KB / 8KB / 1.8KB byte budgets and dedup.

## The "missing doc page" the user couldn't find

Most likely candidate (HIGH confidence): **`npx @next/codemod@canary agents-md`**
- Documented at <https://nextjs.org/docs/app/guides/ai-agents> (the "For earlier versions" details block)
- Detects Next.js version, downloads docs to `.next-docs/`, injects pipe-delimited compressed index into AGENTS.md
- This is the bootstrap npm package matching the user's memory

Alternate candidate (HIGH): `npx create-next-app@canary` — generates AGENTS.md + CLAUDE.md by default in 16.2.

## User decisions confirmed

- **Scope: full Claude-Code plugin port** (not framework-agnostic). Adopt vercel-plugin's hooks/manifest/profiler/targeted-injection stack inside this repo.
- **Doc-sync: deferred.** Keep `sync-docs.sh` and `generate-docs-index.sh` manual and unchanged in v2. Revisit only if doc-rot bites.

## Repo layout to know about

Already exists in this worktree (do **not** rewrite):
- `agents/sui-pilot-agent.md` — current 19.9 KB pipe-delimited index (the v2 target to slim)
- `.claude-plugin/plugin.json` — plugin manifest registering MCP `move-lsp` server
- `mcp/move-lsp-mcp/` — TypeScript MCP server bridging move-analyzer LSP
- `skills/{move-code-quality,move-code-review,move-pr-review,move-tests,oz-math}/SKILL.md` — 5 procedural skills (plus the orchestrator-style `sui-pilot` skill in `commands/`)
- `commands/` — slash commands
- `.sui-docs/`, `.move-book-docs/`, `.walrus-docs/`, `.seal-docs/`, `.ts-sdk-docs/` — bundled corpora (847 files, ~7.8 MB total)
- `sync-docs.sh` — manual upstream sync
- `generate-docs-index.sh` — generates the pipe-delimited index inside `agents/sui-pilot-agent.md`
- `llms.txt` — already exists (1.3 KB) — worth reading for current pointer convention
- `docs/VERSION.json` — version pin emitted by sync script
- `CLAUDE.md` (project-level, 1.8 KB)

The `@`-import that always-loads the index lives in `~/.claude/CLAUDE.md` (the user's global), **not** in this repo.

## Reference: vercel-plugin patterns to port

Source path for the working reference: `/Users/alilloig/workspace/vercel-plugin/`

Key files to read when porting Layer 4 (hooks):
- `hooks/src/inject-claude-md.mts` — eager SessionStart injection pattern
- `hooks/src/session-start-profiler.mts` — project detection + `LIKELY_SKILLS` env var + +5 boost
- `hooks/src/skill-map-frontmatter.mts` + `hooks/src/patterns.mts` — matcher pipeline (path glob, bash regex, import patterns)
- `hooks/src/prompt-patterns.mts` + `hooks/src/prompt-analysis.mts` — prompt scorer (phrases +6, allOf +4, anyOf +1×2, noneOf=−∞) + lexical fallback
- `hooks/src/vercel-context.mts` — `getManagedContextChunkForSkill` + `SKILL_TO_CHUNK` mapping (this is the chunk-extraction mechanism to adapt for `sui.md`)
- `scripts/build-manifest.ts` — pre-compiles glob → regex at build time
- `hooks/hooks.json` — registers all hooks

Byte budgets to mirror (constants in those files):
- PreToolUse: 18000
- UserPromptSubmit: 8000
- Managed context chunk: 1800

## Ordered work

Per `DESIGN_V2.md` § "Ordered next steps":

1. **Layer 1 first**: Slim `agents/sui-pilot-agent.md` from 19.9 KB → ~2 KB. Single biggest token-cost win, validates the pattern. Token target: 4,974 → ~500.
2. **`sui.md` skeleton**: Section headings + 5 fully-fleshed sections (object model, abilities, authorization patterns, storage model, cryptography). Aim ~25–35 KB hand-curated.
3. **Hooks scaffolding**: Port from vercel-plugin. TypeScript `hooks/src/*.mts` compiling to ESM. Reuse globToRegex and dedup primitives.
4. **Backfill skill frontmatter**: Add `pathPatterns` / `bashPatterns` / `importPatterns` / `promptSignals` / `priority` to each existing SKILL.md.
5. **Wire `move-lsp` boost**: If `move_diagnostics` is invoked, treat as strong skill-injection signal.
6. **Doctor + tests**: Snapshot fixtures for Move package + TS dApp scenarios.

## Upstream sources (cite these in commit messages / PR description)

- AGENTS.md outperforms skills (Vercel blog, 2026-01-27): <https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals>
- Next.js AI agents guide (2026-04-10, v16.2.4): <https://nextjs.org/docs/app/guides/ai-agents>
- Vercel Plugin docs page: <https://vercel.com/docs/agent-resources/vercel-plugin>
- vercel/next.js's own AGENTS.md: <https://github.com/vercel/next.js/blob/canary/AGENTS.md>
- Anthropic 1M context GA (2026-03-13): <https://platform.claude.com/docs/en/build-with-claude/context-windows>

## Verification plan summary

(Full version in `DESIGN_V2.md` § "Verification plan")

1. Eval suite — 10–15 stale-training Move tasks, score baseline / v1 / v2.
2. Token regression — always-loaded session tokens must drop from ~5,345 to <800.
3. Snapshot tests — Move package, Sui dApp, Walrus app, Seal app fixtures.
4. `sui-pilot doctor` — manifest parity, MCP availability, hook timeouts.
5. Latency — SessionStart + PreToolUse hooks each <100ms warm.
6. Manual `/move-code-review` quality check on a real repo.

## Anti-goals (won't do in v2)

- Framework-agnostic AGENTS.md tooling (out of scope per user)
- Doc-sync automation, version pinning, freshness warnings (deferred per user)
- Public `@sui-pilot/codemod` npm package mirroring `@next/codemod agents-md` (out of scope)
- Replacing the move-pr-review multi-agent orchestration (it works — preserve it)
