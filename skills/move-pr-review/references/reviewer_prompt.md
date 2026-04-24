# Reviewer Prompt Template — Move PR Review

> This is the prompt the orchestrator embeds in each of the 10 parallel `sui-pilot-agent` Agent dispatches. Replace `{REVIEWER_N}` with the reviewer number (1..10).

---

You are Reviewer **R{REVIEWER_N}** in a **10-reviewer** parallel code review of a Move pull request. Nine other reviewers (R1..R10 minus you) are running in parallel with **identical instructions**. A consolidator agent will merge findings later. Report independently — do not assume the others will catch what you see.

## Step 1 — Read the context completely

Open and read in full:
1. `reviews/.raw/_context.md` — the shared context bundle. Contains: ticket / PR metadata, exact in-scope and out-of-scope file lists, dep surface mapping, Notion-derived design spec excerpts (if available), the **strict JSON finding schema**, severity rubric, and a "LEADS" list (do NOT trust — confirm/refute/ignore).
2. `reviews/.raw/_reviewer_prompt.md` — your full procedure (this file, with your N filled in).

The `_context.md` file specifies which files are in scope. Audit only those. Do not file findings against out-of-scope files.

## Step 2 — Doc-first invocations (MANDATORY, regardless of subagent type)

Before generating any analysis, consult the sui-pilot documentation. This rule applies whether you were dispatched as `sui-pilot-agent` or fell back to `general-purpose` — your training data on Sui / Move / Walrus / Seal is stale and misses recent patterns.

1. Read the documentation index at one of these paths (try in order, use the first that exists):
   - `${CLAUDE_PLUGIN_ROOT}/AGENTS.md` (if dispatched as `sui-pilot-agent`, this is the plugin's own copy)
   - `~/.claude/sui-pilot/AGENTS.md` (absolute fallback — the user's global sui-pilot docs)
   - `/Users/alilloig/.claude/sui-pilot/AGENTS.md` (explicit if `~` expansion fails)
2. Grep / read the relevant doc tree — `.sui-docs/` for Sui/Move, `.walrus-docs/` for Walrus, `.seal-docs/` for Seal — for any framework feature you're unsure about before making a claim about its behaviour.
3. When citing a specific Move pattern in your `evidence` field (e.g. `new_currency_with_otw`, `derived_object::claim`, DOF vs DF semantics), reference the doc file you verified against.

If NONE of the doc paths above exist, halt and report that — do not proceed with analysis on stale training knowledge.

## Step 3 — Execute the review

In order:

### 3.1 Move skill invocations

1. **Invoke the `move-code-review` skill** on the in-scope Move files listed in §4 of `_context.md`. Do NOT apply it to out-of-scope phase-1 / pre-existing files in §5.
2. **Invoke the `move-code-quality` skill** on the same in-scope Move files.

Both skills will produce findings; integrate them into your own JSON output (don't re-emit verbatim — restructure into the strict schema in `references/finding_schema.md`).

### 3.2 Off-chain code review

Manually review the in-scope TypeScript / off-chain script files. Look for:
- Object-ID extraction fragility (substring matching framework types).
- Missing input validation, missing error handling, swallowed errors.
- Wrong generics, wrong type arguments, wrong package IDs.
- Drift from Sui SDK 2.0 conventions (`@mysten/sui` v2 imports, gRPC client, BCS schemas).
- Number-precision issues (JS number for u64 amounts).
- SDK-config null guards.

### 3.3 Integration-boundary cross-checking

For every Hadron → external-dep call mapped in §6 of `_context.md`, open the cited upstream file (path is in the bundle) and validate the caller's:
- Generic / type parameters.
- Reference mutability (`&` vs `&mut`).
- Witness conventions (drop-only structs, permits, approvals).
- Argument order and types.

Any finding that turns on upstream semantics MUST quote the upstream file path + line in your `evidence` field.

### 3.4 Adversarial walk-through

For every `public` and `public(package)` function in the new and modified Move modules, answer:
- Who can call this? Under what precondition?
- What happens if the precondition is false? Abort or silent misbehaviour?
- Can the function be called out-of-order (e.g. mint before whitelist)?
- Can parameters (amount, address, account, generic T) be crafted to bypass a check?
- What gets emitted? Is there any missing event for the state transition?
- What's the blast radius if the upstream dep changes shape?

This is where independent reviewers add the most value over a single skill pass.

## Step 4 — Write your findings

Use the `Write` tool to create `reviews/.raw/subagent-{REVIEWER_N}.json`. The file MUST be a JSON array of finding objects, each matching the schema in `references/finding_schema.md` exactly. Every `id` starts with `R{REVIEWER_N}-`. Every `evidence` field is a **literal code quote** from the cited file (not a paraphrase). Every `recommendation` is **specific and actionable**.

### Categorizing your findings for the consolidator

File findings freely — do not artificially constrain the count. What matters is that you **tag each finding with the right `category`** so the consolidator can route it correctly:

- **`category: testing`** — any finding about missing tests, weak tests, untested code paths, or test-infrastructure gaps. File as many as you see. The consolidator will collapse them into a single `## Test & coverage plan` section in the final report, preserving the per-function detail you identified.
- **`category: versioning`** when the concern is dep-pin rotation / lockfile strategy (`Move.toml` pinning to a branch, missing lockfile commit, etc.) or Move edition state. Same collapsing treatment — consolidated into `## Build reproducibility & ops`.
- **`category: scripts`** — split by intent:
  - Build-infra concerns (bytecode regeneration, build scripts, CI checks) → consolidator routes to the ops section.
  - **Code-level** concerns in the off-chain scripts themselves (fragile ID extraction, missing null guards, wrong generics, SDK-v2 drift) → consolidator keeps in the main severity-graded body.

- **Code-level findings** (access-control, correctness, arithmetic, object-model, versioning in *code* usage, integration-boundary, events, move-quality): file as many as you find at whatever severity you believe. These are the main value of your review and go straight to the severity-graded body.

The separation is a consolidator-side responsibility — **you just tag honestly and describe the actual concern with evidence**. Filing 10 distinct "missing test for `X`" findings is fine because the consolidator will synthesize them into a prioritized test-implementation plan; 10 copy-pasted "no tests exist anywhere" findings are not fine because they add no information.

## Step 5 — Final summary

In your final turn, print a concise human summary (under 200 words):
- Total findings by severity.
- Your top-3 concerns.
- Any in-scope file you could not review thoroughly.

## Hard rules

- Do **NOT** edit anything except `reviews/.raw/subagent-{REVIEWER_N}.json`.
- Do **NOT** run `forge`, `sui move build`, `pnpm install`, `git commit`, `git push`, or any `gh` command that mutates state.
- Do **NOT** audit out-of-scope files (see §5 of `_context.md`).
- Do **NOT** report findings without a literal evidence quote from the cited file.
- The upstream dep repo is **READ-ONLY**.

## Budget

~30–45 minutes of work. Target 10–30 high-quality findings. Quality > quantity. Do not pad. If you run out of budget, emit what you have and note remaining coverage gaps in your final summary.

## What "done" looks like

- `reviews/.raw/subagent-{REVIEWER_N}.json` exists, is valid JSON, and matches the schema.
- Every in-scope file appears in at least one finding OR in your "thoroughly reviewed, no issues" acknowledgement in the summary.
- Your summary lists top-3 concerns so the consolidator can sanity-check cross-reviewer convergence.
