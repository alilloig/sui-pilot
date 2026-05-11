# sui-pilot v2 postmortem — the Vercel-port that wasn't

This document records what the `feat/v2-graph-port` branch tried, why the evals rolled it back, and what shipped in the end. It subsumes the old `DESIGN_V2.md` (full architectural plan) and `RESEARCH_NOTES.md` (research recovery doc) — both deleted in the same commit that introduced this file.

## What v2 originally tried

The branch ported the full architecture of `vercel-plugin` (the Vercel official Claude-Code plugin) into sui-pilot, in four layers:

1. **Slim always-loaded preamble** — `agents/sui-pilot-agent.md` collapsed from a 19.4 KB pipe-delimited file index to a 2.9 KB topic-routing table. The agent navigates `.<source>-docs/` directly via `Glob`/`Grep` instead of reading a precomputed index.
2. **Ecosystem graph** — a new `sui.md` (445 lines, 13 sections) modeled on `vercel.md`, with `⤳ skill:` markers and `→ depends on` edges. Co-injected per matched skill via a chunk-extraction mechanism.
3. **Bundled docs** — already in place from v1 (`.sui-docs/`, `.move-book-docs/`, `.walrus-docs/`, `.seal-docs/`, `.ts-sdk-docs/`), no changes.
4. **Hooks pipeline** — ported wholesale from `vercel-plugin/hooks/src/*.mts`. A SessionStart profiler, a PreToolUse path/bash/import matcher, a UserPromptSubmit prompt scorer, byte budgets, dedup, a `/sui-pilot-doctor` health check, a `scripts/build-manifest.ts` step that precompiled `skills/*/SKILL.md` frontmatter into `generated/skill-manifest.json`. ~7,500 LOC of `.mts` source / ~15 K LOC including compiled `.mjs`.

The thesis was: minimal preamble + bundled docs + curated graph + plugin-internal targeted injection is the state-of-the-art shape for a Claude Code plugin. The research that supported this is preserved in `git log` on the early commits of this branch; the short version is that Next.js 16.2 collapsed AGENTS.md to a one-line pointer (docs co-located in `node_modules/next/dist/docs/`), and `vercel.md` is positioned as a *complementary* curated graph that Vercel ships alongside AGENTS.md.

## What the evals said

Two scored A/B runs against a 15-task suite (Move 2024 syntax migrations, OTW pattern, dynamic object fields, transfer policies, randomness, Walrus, Seal, SDK 2.0 migration, etc.). Both runs preserved in `evals/BASELINE.md`.

**Precut (2026-04-30, full v2 architecture)**

| | v1 (main) | v2 (full port) |
|---|---|---|
| Literal grader | 15/15 | 13/15 |
| Functional (adjudicated) | 13/15 | 13/15 |

Functional parity. The literal grader gap was 4 grader artefacts in opposite directions (TODO-comment false positives on v1, idiomatic-form false negatives on v2). The post-eval notes flagged a "verbose-TODO tendency" on v2 — tasks 09/14/15 — that the scorer suspected was caused by **matcher over-injection** (more reading material → satisficing on implementation).

**Postcut (2026-05-11, after cutting the matcher pipeline)**

| | v1 (main) | v2-minimal (this PR HEAD) |
|---|---|---|
| Literal grader | 14/15 | 14/15 |
| Δ | — | 0 |

Dead heat. The trimmed v2 produces bit-identical outputs to v1 on every task. The precut verbose-TODO regression has resolved without the matcher.

## Why we cut

The matcher exists to disambiguate skills against vague prompts when a plugin has many of them. `vercel-plugin` ships ~19 skills; sui-pilot ships **5, all directly invokable as slash commands** (`/move-code-quality`, `/move-code-review`, `/move-pr-review`, `/move-tests`, `/oz-math`). The matcher was solving a problem this plugin doesn't have.

A second tell: `hooks/src/lexical-index.mts` (1,978 lines, the lexical retrieval fallback) shipped with a SYNONYM_MAP that was Vercel vocabulary verbatim — `ssr`, `isr`, `next-rewrite`, `edge-middleware`, `satori`, `preview-deployment`, `feature-flag`, `og/opengraph`. Never re-tuned for Sui or Move. The transplant was structural, not semantic.

The evals removed the doubt. Functional parity precut, identical-output parity postcut, ~17 K LOC removed.

## What got cut

| Path | Reason |
|---|---|
| `hooks/` (full tree: `src/*.mts`, `*.mjs`, `tsup.config.ts`, `tsconfig.json`, `hooks.json`, `package.json`, `pnpm-lock.yaml`, `test/`) | Matcher pipeline + Vercel-vocab lexical index + the orphan `stemmer.mts` + `unified-ranker.mts` (never imported even in v2). |
| `sui.md` | Runtime consumer was only `hooks/src/sui-context.mts`. Dies with the matcher. |
| `sui-session.md` | Runtime consumer was only `hooks/src/inject-sui-context.mts`. Dies with the matcher. |
| `generated/skill-manifest.json` + `scripts/build-manifest.ts` | The manifest was consumed only by the two injection hooks. |
| `scripts/doctor.ts` + `scripts/verify.sh` + `commands/sui-pilot-doctor.md` | Health checks for components that no longer exist. |
| `CONTEXT_INJECTION.md` | 543-line walkthrough of the pipeline. |
| `DESIGN_V2.md` + `RESEARCH_NOTES.md` | Architectural rationale and research notes, both subsumed by this file. |
| `metadata:` frontmatter blocks in all 5 `skills/*/SKILL.md` | Matcher signals; inert without the manifest. |

## What ships

- `agents/sui-pilot-agent.md` — slim doc-first preamble, always-loaded via `@`-import from the user's `~/.claude/CLAUDE.md`.
- `skills/{move-code-quality,move-code-review,move-pr-review,move-tests,oz-math}/SKILL.md` — 5 user-invokable slash skills. Bodies untouched.
- `mcp/move-lsp-mcp/` — MCP server bridging `move-analyzer` (LSP) into Claude Code. Registered in `.claude-plugin/plugin.json`.
- `.sui-docs/`, `.move-book-docs/`, `.walrus-docs/`, `.seal-docs/`, `.ts-sdk-docs/` — bundled corpora (~695 files).
- `evals/` — 15-task A/B harness (`run-comparison.sh`, `tasks.json`, `fixtures/`, `BASELINE.md`).

## What stays open

- **Tighten the eval grader.** The current substring-only criteria reject idiomatic Move 2024 forms (e.g. `coin::create_currency<DEMO>(otw,` is correct but fails the literal check). The next iteration should accept method-call ↔ module-qualified equivalence and reject substring matches inside comment blocks. Tracked in `evals/BASELINE.md`.
- **A denser eval suite.** All 15 tasks are single-file criterion-targeted edits that both v1 and v2-minimal handle identically. To get decision-grade signal between architectures the suite needs multi-file refactors, ambiguous specs, or tasks where the wrong doc is reachable.

## Lesson

Transplanted architecture is a hypothesis, not a conclusion. The matcher pipeline was a good idea *for the plugin where it was first written*; it didn't pay rent here because sui-pilot's skills aren't ambiguous — the user types `/move-code-review` when they want a review. The eval suite caught what review wouldn't have.
