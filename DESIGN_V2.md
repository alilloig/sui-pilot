# Deep Research: Vercel AI Tooling Direction & Sui-Pilot v2 Port

## Context

The user asked whether `vercel.md` (in this repo) is the natural evolution of the **January 27, 2026 Vercel blog post** ("AGENTS.md outperforms skills in our agent evals") — driven by Claude Code's reported 1M context window making strict pipe-delimited indexing "overkill," and therefore deprecating that AGENTS.md pattern. If true, port the new approach to `sui-pilot` for a state-of-the-art revision.

The user also recalled, but couldn't find, a Vercel developer doc page tied to a bootstrapping npm package that documented the AGENTS.md pattern.

## Research method

- **Phase 1 (local, repo-first):** Two parallel `Explore` agents — one over `/Users/alilloig/workspace/vercel-plugin/`, one over `~/.claude/sui-pilot/`. Read hooks, manifests, scripts, snapshots, git log.
- **Phase 2 (upstream):** Targeted `WebFetch` on three primary sources (Jan blog, Next.js 16.2 AI guide, Vercel Plugin docs page) + `WebSearch` for the missing-doc-page lead and the 1M-context premise.
- **Confidence ranking:** `[observed]` = directly read in code/docs; `[inferred]` = reasoning over observations; `[hypothesis]` = unverified claim.
- **Time-boxed** upstream queries to one fetch + one search per axis.

## Verdict

**FALSE — the hypothesis is misframed.** [observed]

`vercel.md` is **not** the evolution of AGENTS.md, and AGENTS.md has **not** been deprecated. They are **two different artifacts at different layers of the stack**, both still actively recommended by Vercel as of April 2026.

What *has* happened: the **pipe-delimited compressed index** prescribed in the Jan 2026 article (40KB → 8KB) has been superseded — but **not by `vercel.md`**. It was superseded by **direct doc co-location** in Next.js 16.2 (`node_modules/next/dist/docs/`), where `AGENTS.md` collapsed to a *single-line pointer*. The 1M context window is real (Anthropic GA'd it Mar 13, 2026 at standard pricing) but is **not load-bearing** for the design choice — vercel-plugin still enforces 18KB / 8KB / 1.8KB byte budgets and dedup, treating context as scarce.

## Local findings: vercel-plugin

[observed] — Architecture is **multi-stage, budget-gated, dedup-aware**:

| Layer | Trigger | Budget | What gets injected |
|---|---|---|---|
| SessionStart eager (`hooks/src/inject-claude-md.mts:106-108`) | Greenfield OR Vercel/Next.js markers detected | none | `vercel-session.md` (~600B) + `knowledge-update/SKILL.md` body + greenfield directive |
| SessionStart profiler (`hooks/src/session-start-profiler.mts:167-201`) | Same gate as above | env var only | Sets `VERCEL_PLUGIN_LIKELY_SKILLS` (+5 priority boost) from `next.config.*`, `vercel.json`, `middleware.*`, `package.json` deps |
| PreToolUse skill match (`hooks/src/pretooluse-skill-inject.mts:64,419-780`) | Read/Edit/Write/Bash | `VERCEL_PLUGIN_INJECTION_BUDGET=18000` | Up to 3 skills, ranked by priority+boost, dedupped via `/tmp/vercel-plugin-<sessionId>-seen-skills.d/` |
| UserPromptSubmit (`hooks/src/prompt-patterns.mts:151-320`) | Prompt scoring ≥6 (phrases +6, allOf +4, anyOf +1×2, noneOf=−∞) + lexical fallback | `VERCEL_PLUGIN_PROMPT_INJECTION_BUDGET=8000` | Up to 2 skills |
| Managed context chunk (`hooks/src/vercel-context.mts:10,33-52,87-139`) | Co-injected with selected skill | `DEFAULT_CONTEXT_CHUNK_BUDGET_BYTES=1800` | One section of `vercel.md` extracted by heading via `getManagedContextChunkForSkill` (19 skills → 6 chunks) |

`vercel.md` itself: **42 `⤳ skill:` markers** across 12 sections + Legend with edge syntax (`→ depends on`, `↔ integrates with`, `⇢ alternative to`, `⊃ contains`).

**Migration signal in git log** [observed]:
- `8449a2a` "refactor: replace bundled skills with engine/ rules + registry resolution"
- `66ea38a` (same theme) — engine rules (FILE_MARKERS / PACKAGE_MARKERS) became canonical, replacing static bundled docs
- `eb3b6f1` "feat: engine-driven skill orchestration with tiered SessionStart"
- `fd8c614` "add microfrontends to ecosystem graph and regenerate skill catalog" — explicit graph-as-source-of-truth

**No commits mention "AGENTS.md" migration.** [observed] vercel.md is positioned as a **complementary artifact** to AGENTS.md, not a replacement. The official docs page (`vercel.com/docs/agent-resources/vercel-plugin`) calls it the "Ecosystem graph" and lists it alongside skills/agents/commands.

## Local findings: sui-pilot

[observed] — Architecture is **eager-load-everything index + lazy-grep raw corpus**:

| Component | Loaded | Format | Size | Update |
|---|---|---|---|---|
| `agents/sui-pilot-agent.md` (the index) | Always (via `@`-import in `~/.claude/CLAUDE.md`) | Pipe-delimited file inventory | **19.9 KB ≈ 4,974 tokens** | Manual `sync-sui-pilot-docs.sh` |
| 5 doc corpora (`.sui-docs/`, `.move-book-docs/`, `.walrus-docs/`, `.seal-docs/`, `.ts-sdk-docs/`) | Lazy / grep-on-demand | 847 files, **7.8 MB** | Manual sync script |
| MCP `move-lsp` (`.claude-plugin/plugin.json`) | Session init | TypeScript MCP server | move-analyzer LSP bridge |
| 5 procedural skills (`move-code-quality`, `move-code-review`, `move-pr-review`, `move-tests`, `oz-math`) | Invoked via `/` | SKILL.md + workflows | Plugin distribution |
| Global `~/.claude/CLAUDE.md` | Always (via `@`-import) | Markdown directives | 1.5 KB | Manual edit |

**Total always-loaded ≈ 5,345 tokens.** Pure index + raw corpus. **No graph-shaped curated knowledge anywhere.** [observed] No hooks (no `.claude/hooks/`), no profiler, no budget enforcement, no dedup. The `move-pr-review` skill orchestrates 11 parallel sub-agents — the only multi-agent pattern in the system.

## Upstream findings

| URL | Date | One-line synthesis | Hypothesis axis |
|---|---|---|---|
| [vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) | 2026-01-27 | AGENTS.md (pipe-delimited compressed index, 40KB → 8KB) hit 100% vs Skills' 53–79% on Next.js 16 evals. Positions AGENTS.md as **complementary** to skills, not replacing them. | Weakens hypothesis: complementary, not superseding |
| [nextjs.org/docs/app/guides/ai-agents](https://nextjs.org/docs/app/guides/ai-agents) | 2026-04-10 (v16.2.4) | **In Next.js 16.2, AGENTS.md collapsed to a single-line pointer** to `node_modules/next/dist/docs/`. The pipe-delimited index lives in the codemod fallback only (`@next/codemod agents-md` for v16.1 and earlier — outputs to `.next-docs/`). | Refutes "1M context deprecates indexing" — replaced by **doc co-location**, not by larger context |
| [vercel.com/docs/agent-resources/vercel-plugin](https://vercel.com/docs/agent-resources/vercel-plugin) | current | Vercel positions the plugin as Claude-Code/Cursor-specific tooling; calls `vercel.md` the "Ecosystem graph" alongside skills/agents/commands. **No mention of AGENTS.md replacement.** | Refutes hypothesis: vercel.md is a *different layer* |
| [github.com/vercel/next.js/blob/canary/AGENTS.md](https://github.com/vercel/next.js/blob/canary/AGENTS.md) | current | Vercel's own canonical AGENTS.md: 446 lines, **hybrid prose + skill pointers** (`$pr-status-triage` → `.agents/skills/pr-status-triage/SKILL.md`). Same pattern shape as vercel.md's `⤳ skill:` markers. | Confirms the pointer-pattern is convergent across both files; weakens "deprecation" claim |
| [github.com/vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (referenced) | current | Repo of agent-skills with its own AGENTS.md. AGENTS.md as a discovery convention is alive. | Weakens hypothesis |
| [Anthropic 1M GA](https://platform.claude.com/docs/en/build-with-claude/context-windows) (multiple confirmations) | 2026-03-13 | 1M context GA on Opus 4.6 / Sonnet 4.6 for Max/Team/Enterprise inside Claude Code, **standard pricing**. | The premise is **true** — but the plugin's preserved byte budgets show it's not load-bearing for the design |

## Missing-doc-page lead

The user's "bootstrapping npm package" memory most likely refers to one of these. Confidence-ranked:

1. **HIGH — `npx @next/codemod@canary agents-md`** — official Vercel/Next.js codemod that detects Next.js version, downloads docs to `.next-docs/`, and injects the pipe-delimited compressed index into AGENTS.md. **This exactly matches "bundled on some bootstrapping npm package."** Documented at [nextjs.org/docs/app/guides/ai-agents](https://nextjs.org/docs/app/guides/ai-agents) (the "For earlier versions" details block). [observed]
2. **HIGH (alternate match) — `npx create-next-app@canary`** — As of Next.js 16.2 (April 2026), generates `AGENTS.md` + `CLAUDE.md` by default; opt out with `--no-agents-md`. Documented in the same guide. If the user remembers seeing this on a Vercel docs page, this is the second-best match. [observed]
3. **MEDIUM — `vercel.com/docs/agent-resources` index page** — Vercel maintains a docs section dedicated to AGENTS.md / agent-readability conventions ([Agent Readability spec](https://vercel.com/kb/guide/agent-readability-spec), [Make your documentation readable by AI agents](https://vercel.com/kb/guide/make-your-documentation-readable-by-ai-agents)). Less of a "bootstrap npm package" angle but matches "developer doc page" framing. [observed]
4. **LOW — `npx plugins add vercel/vercel-plugin`** — the install path for *this* plugin. Doesn't fit the "bootstrap" memory shape but listed for completeness.

If the user is thinking of a single page, candidate **#1 (`@next/codemod agents-md`)** is the strongest fit.

## Comparative analysis

| Axis | AGENTS.md (Jan 2026 article) | AGENTS.md (Next.js 16.2, April 2026) | `vercel.md` (this plugin) | sui-pilot pipe-index (today) |
|---|---|---|---|---|
| Loading model | Eager, project-root, agent-agnostic | **Eager pointer** (1 line) → docs lazy-grepped from `node_modules/` | **Conditionally injected chunks** via skill match | **Eager** (full 19.9 KB index always loaded) |
| Content shape | Compressed pipe-delimited index | Single instruction + pointer | Hand-curated relational graph + `⤳ skill:` markers | Pipe-delimited file inventory |
| Activation gating | None (always read) | None | Profiler-gated (greenfield/Vercel/Next.js) + skill-match | None |
| Retrieval/ranking | None | None | Multi-signal (path glob, bash regex, import, prompt scoring) + dedup | None (grep on demand) |
| Update model | Hand or codemod | `pnpm update next` (docs ship in package) | Hand-edited graph + scripted skill manifest | Manual `sync-docs.sh` |
| Token cost at session start | ~8 KB compressed | <100 B pointer | 0 (deferred to skill match) + ~600B session-context | **~5,345 tokens always** |
| Maintenance burden | Medium (regenerate index) | **Low** (npm package owns docs) | Medium (graph + skills) | Medium (script + index drift) |
| Doc-rot resilience | Low (index drifts from upstream) | **High** (versioned with `next` package) | Medium (graph stable, skills can rot) | Low (no version pinning) |
| Fit for large context windows | Good | **Best** (lets the agent read freely) | Good (chunked, budgeted) | OK (not optimized) |

### Evidence for the hypothesis
- The pipe-delimited index pattern from January is no longer the recommended approach in Next.js 16.2. [observed]
- vercel-plugin migrated commits show movement *away* from "passive bundled skills" toward engine-driven dynamic injection. [observed]

### Evidence against the hypothesis
- Vercel **still ships AGENTS.md by default** in `create-next-app` as of April 2026. [observed]
- Vercel maintains a dedicated [agent-resources docs section](https://vercel.com/docs/agent-resources). [observed]
- `vercel.md` is positioned as the plugin's "Ecosystem graph" alongside skills/agents/commands — not as a replacement for AGENTS.md. [observed]
- vercel-plugin enforces strict byte budgets (18 KB / 8 KB / 1.8 KB) and dedup, so 1M context is **not load-bearing** for the design. [observed]
- vercel/next.js's own AGENTS.md (446 lines) uses the same `⤳ skill:`-style pointer pattern as vercel.md — they are **the same pattern at different layers**, not competing approaches. [observed]

### Falsifier check
A clean falsifier would be: Vercel publicly stating AGENTS.md is deprecated, OR `create-next-app` removing AGENTS.md generation. **Neither has happened.** Both are alive and recently strengthened. [observed]

## Sui-pilot v2 architecture recommendation

The correct port is **not** "abandon the pipe-index because vercel.md replaced it." The correct port is the **same architectural insight Vercel learned**: minimal pointer + colocated bundled docs + complementary curated graph + plugin-internal targeted injection.

### Layer 1 — Slim the always-loaded preamble (AGENTS.md/CLAUDE.md pattern)

[observed gap] — Today, `agents/sui-pilot-agent.md` is **19.9 KB always loaded** in every session. That's the deprecated pattern. Replace with:

- **`~/.claude/sui-pilot/agents/sui-pilot-agent.md` v2** — collapse to <2 KB: a doc-first directive + grep paths + skill pointers, mirroring Next.js 16.2's `<!-- BEGIN:nextjs-agent-rules -->` shape. Drop the pipe-delimited file index entirely; the agent can `Glob` instead.
- Keep the `@`-import from `~/.claude/CLAUDE.md` unchanged.

**Estimated token-cost reduction: 4,974 → ~500 tokens always-loaded.**

### Layer 2 — Add `sui.md` (the relational graph)

[new] — Mirror `vercel.md`. Hand-curated, **concept-stable** content only. Sections:

- **Sui object model** — address-owned / shared / immutable / wrapped / party / dynamic-fields, with `⤳ skill:` markers
- **Move type system & abilities** — `copy`/`drop`/`key`/`store`, with examples linking to `.move-book-docs/`
- **Authorization patterns** — capability, witness, hot potato, OTW, publisher
- **Storage model** — UID/ID, transfer rules, transfer policies, kiosk
- **Cryptography & primitives** — Seal, hashing, signatures, randomness, Walrus blob storage
- **TS SDK 2.0 migration awareness** — *just* the breaking-change axes; defer details to grep
- **Tooling** — Sui CLI, Move 2024 edition, MCP move-analyzer

Edge syntax: `→ depends on`, `↔ integrates with`, `⇢ alternative to`, `⊃ contains`. Skill pointers: `⤳ skill: move-code-quality`, etc.

**Target size:** ~25–35 KB hand-curated graph. **Not always injected.** Co-injected per-skill via the same chunk-extraction mechanism as `vercel-context.mts`.

### Layer 3 — Doc co-location (already done, just acknowledge)

[observed] — `.sui-docs/`, `.move-book-docs/`, `.walrus-docs/`, `.seal-docs/`, `.ts-sdk-docs/` are already bundled. **Keep as-is.** This is the *same pattern* as Next.js's `node_modules/next/dist/docs/`. The version-pinning gap (Sui ships breaking changes monthly) is the real risk — see Layer 5.

### Layer 4 — Add hooks + targeted injection (port from vercel-plugin)

[new] — Add `.claude-plugin/hooks/` modeled on vercel-plugin's `hooks/src/`:

| Hook | Trigger | Mechanism |
|---|---|---|
| SessionStart profiler | Detects Move project (`Move.toml`), Sui dApp (TS SDK imports), Walrus/Seal usage, Move 2024 edition | Sets `SUI_PILOT_LIKELY_SKILLS` env var |
| PreToolUse skill match | `*.move`, `Move.toml`, `@mysten/*` imports, `sui client` bash | Inject relevant skill body + matching `sui.md` chunk |
| Managed context chunks | Co-injection per skill | Adapt `getManagedContextChunkForSkill` |

Skills already exist (`/move-code-quality`, `/move-code-review`, `/move-pr-review`, `/move-tests`, `/oz-math`) — wire them into the matcher pipeline with `pathPatterns`, `bashPatterns`, `importPatterns`, `promptSignals` frontmatter.

### Layer 5 — Doc-rot strategy (deferred per user decision)

[observed risk, deliberately deferred] — Sui ships breaking changes far more often than Next.js, so the bundled-doc layer can drift fast. **The user has chosen to defer doc-sync changes in v2** and keep the current manual `sync-sui-pilot-docs.sh` flow as-is. v2 focuses all effort on the slimming + graph + hooks work. Revisit if doc-rot bites in practice.

What v2 *will* do, since it's free:
- `sui-pilot doctor` (mirroring `vercel-plugin doctor`) for **manifest parity, MCP availability, hook timeout health** — but **not** corpus version validation. Adding the corpus-version check is the natural follow-up if doc-rot becomes painful.

What v2 will *not* do (out of scope):
- Pinning sync to a Sui release tag
- Auto-emitting `VERSION.json` warnings into `sui-pilot-agent.md`
- Any automation around doc freshness

### Concrete files to add/modify in `~/.claude/sui-pilot/`

| Action | File | Notes |
|---|---|---|
| **Replace** | `agents/sui-pilot-agent.md` | Collapse to ~2 KB; remove pipe index; keep doc-first rule + skill pointers |
| **Add** | `sui.md` | Hand-curated relational graph, ~30 KB |
| **Add** | `hooks/src/sui-context.mts` | Adapt `getManagedContextChunkForSkill` for `sui.md` |
| **Add** | `hooks/src/session-start-profiler.mts` | Move/Sui project detection |
| **Add** | `hooks/src/pretooluse-skill-inject.mts` | Path/bash/import matchers for Move/Sui |
| **Add** | `hooks/hooks.json` | Wire SessionStart + PreToolUse + UserPromptSubmit |
| **Add** | `scripts/build-manifest.ts` | Pre-compile skill matchers |
| **Add** | `generated/skill-manifest.json` | Runtime artifact |
| **Modify** | Each `skills/*/SKILL.md` | Add YAML frontmatter (`pathPatterns`, `bashPatterns`, `importPatterns`, `promptSignals`, `priority`) |
| **Add** | `src/cli/sui-pilot-doctor.ts` | Mirror `vercel-plugin doctor` |
| **Keep as-is** | `scripts/sync-sui-pilot-docs.sh` | Doc-sync changes deferred per user decision |
| **Keep** | `.sui-docs/`, `.move-book-docs/`, `.walrus-docs/`, `.seal-docs/`, `.ts-sdk-docs/` | The bundled-doc layer is correct as-is |
| **Keep** | `.claude-plugin/plugin.json` (MCP `move-lsp`) | LSP integration is a strength; extend with hooks block |

## Ordered next steps (research-next, not code-now)

1. **Confirm** with the user the verdict and the recommended port direction (this plan, via ExitPlanMode).
2. **Branch sui-pilot v2 design doc**: write `~/.claude/sui-pilot/DESIGN_V2.md` capturing the layer-by-layer plan above with exact module signatures.
3. **Prototype Layer 1 first** (slim the always-loaded preamble) — lowest risk, biggest token-cost win, validates the pattern before investing in hooks.
4. **Author `sui.md` skeleton** with section headings + ~5 fully-fleshed sections (object model, abilities, authorization patterns) — enough to test the graph-chunk mechanism.
5. **Port the hook scaffolding** from vercel-plugin (`hooks/src/*.mts`, `scripts/build-manifest.ts`) — TypeScript files that compile to ESM. Reuse vercel-plugin's `globToRegex`, dedup primitives.
6. **Backfill skill frontmatter** for the existing 5 skills.
7. **Wire MCP `move-lsp` boost** — if `move_diagnostics` is invoked in a session, treat it as a strong signal to inject Move-related skills.
8. **Doctor + tests**: snapshot tests over a fixture project (Move package + TS dApp), assert injection metadata.
9. **Telemetry-light release**: ship behind a feature flag in `~/.claude/CLAUDE.md`, A/B against current sui-pilot for 1–2 weeks.

## Risks, assumptions, open questions

### Risks
- **Doc-rot** is sharper for Sui than Next.js (monthly breaking changes). The bundled-doc layer needs a maintenance cadence the user is willing to commit to.
- **Maintenance asymmetry**: vercel-plugin is a team product; sui-pilot is a personal/global plugin. Adding hooks/manifests/scripts increases ongoing work for one person.
- **Token regression**: if `sui.md` chunks are over-injected, total per-session tokens could *grow* despite slimming the preamble. Budget enforcement (mirror `VERCEL_PLUGIN_INJECTION_BUDGET`) is non-negotiable.
- **Move-analyzer LSP dependency**: MCP integration assumes a working `move-analyzer` install on the user's machine. The current sui-pilot tolerates this; v2 should not regress.

### Decisions confirmed by user
- **Scope: full Claude-Code plugin port.** v2 adopts vercel-plugin's full architecture (hooks, manifest, profiler, targeted injection) inside `~/.claude/sui-pilot/`. Framework-agnostic AGENTS.md tooling is **not** a goal.
- **Doc-sync: deferred.** Keep `sync-sui-pilot-docs.sh` manual and unchanged in v2. Revisit only if doc-rot causes real pain.

### Standing assumptions
- The user is comfortable maintaining hand-curated graph content in `sui.md`. Justification: they wrote the existing pipe-index by hand and asked for "state of the art."
- The 1M context window applies to the user's Claude Code subscription (Max/Team/Enterprise). Confirmed for design but not load-bearing — budgets still apply.

### Open questions
- Should `sui.md` be generated from doc frontmatter (like the `corpus-qa-skill-pattern` skill recommends) or hand-authored? *Recommendation:* hand-authored for concept-stable nodes; generated for the file index appendix if needed.
- Should Walrus/Seal be in the same graph or separate (`walrus.md`, `seal.md`)? *Recommendation:* one graph with cross-edges, mirroring vercel.md's product-spanning approach.
- Do we want a public "AGENTS.md for Sui projects" output similar to `@next/codemod agents-md`? Out of scope for v2 — the user explicitly chose Claude-Code-only scope.

## Verification plan

How to evaluate that sui-pilot v2 actually outperforms v1:

1. **Eval suite (mirror Vercel's methodology)** — pick 10–15 Move tasks where current Sui training data is stale: Move 2024 syntax migrations, OTW pattern, dynamic object fields, transfer policies, party objects, gRPC client (post 2.0). Score: pass rate and token-cost-per-task across:
   - Baseline (no sui-pilot)
   - Current sui-pilot (v1 — pipe index)
   - sui-pilot v2 (slim preamble + sui.md + hooks)
2. **Token budget regression test** — measure always-loaded session tokens on a fixed scenario; v2 must reduce vs v1 (target: 5,345 → <800).
3. **Snapshot tests** over fixture projects — assert correct skill+chunk injection for: pure Move package, Sui dApp (TS), Walrus blob app, Seal-protected app.
4. **`sui-pilot doctor`** — must pass on a clean install; manifest parity, MCP availability, hook timeout health. (Corpus-version check deferred with the rest of doc-sync work.)
5. **Latency check** — SessionStart hook + PreToolUse hook must each complete in <100ms on a warm cache.
6. **Manual qualitative check** — run `/move-code-review` on a real-world repo before/after; v2 review quality must be ≥ v1.

## Bottom line

The user's intuition was directionally right that "the pipe-delimited index is showing its age," but the *cause* and *replacement* are different from what they thought. The 1M context window is not the deprecating force; **doc co-location** is. And `vercel.md` is not AGENTS.md's successor; it's a **complementary plugin-internal layer** that Vercel ships *alongside* AGENTS.md. The sui-pilot v2 port is therefore not "copy vercel.md to sui.md" — it's "adopt the full layered architecture: minimal preamble + bundled docs (already done) + curated graph + targeted injection hooks." That's the actual state-of-the-art.
