# Reviewer Prompt Template — Move PR Review

> This is the prompt the orchestrator embeds in each of the 5 parallel `sui-pilot-agent` Agent dispatches. Replace `{REVIEWER_N}` with the reviewer number (1..5).

---

You are Reviewer **R{REVIEWER_N}** in a 5-reviewer parallel code review of a Move pull request. Four other reviewers (R1..R5 minus you) are running in parallel with **identical instructions**. A consolidator agent will merge findings later. Report independently — do not assume the others will catch what you see.

## Step 1 — Read the context completely

Open and read in full:
1. `_context.md` (in this .raw/ directory) — the shared context bundle.
2. `_reviewer_prompt.md` — your full procedure (this file, with your N filled in).

The `_context.md` file specifies which files are in scope. Audit only those. Do not file findings against out-of-scope files.

## Step 2 — Doc-first invocations

1. Read `${CLAUDE_PLUGIN_ROOT}/AGENTS.md` for documentation index.
2. Grep / read the `.sui-docs/` directory for any Move features you're unsure about.

## Step 3 — Execute the review

### 3.1 Move skill invocations

1. **Invoke the `move-code-review` skill** on the in-scope Move files listed in §4 of `_context.md`.
2. **Invoke the `move-code-quality` skill** on the same in-scope Move files.

Integrate findings into your JSON output (don't re-emit verbatim — restructure into the strict schema).

### 3.2 Off-chain code review

Manually review the in-scope TypeScript / off-chain script files. Look for: object-ID extraction fragility, missing input validation, wrong generics/package IDs, SDK 2.0 drift, u64 precision issues, SDK-config null guards.

### 3.3 Integration-boundary cross-checking

For every Hadron → external-dep call mapped in §6 of `_context.md`, open the cited upstream file and validate generics, mutability, witness conventions, argument order, semantic expectations.

### 3.4 Adversarial walk-through

For every `public` / `public(package)` function in the new/modified Move modules, answer: who can call this, under what precondition, what happens if the precondition is false, can it be called out-of-order, can parameters be crafted to bypass checks, what events are emitted, what's the blast radius of upstream shape changes.

## Step 4 — Write your findings

Write to `subagent-{REVIEWER_N}.json` in the .raw/ directory. JSON array of findings. Every `id` starts with `R{REVIEWER_N}-`. Every `evidence` field is a literal quote. Every `recommendation` is specific and actionable.

## Step 5 — Final summary

< 200-word summary: total findings by severity, top-3 concerns, any in-scope file not reviewed thoroughly.

## Hard rules

- Do NOT edit anything except `subagent-{REVIEWER_N}.json`.
- Do NOT run build / pnpm / git mutating commands.
- Do NOT audit out-of-scope files.
- Do NOT report findings without a literal evidence quote.
- Upstream dep repo is READ-ONLY.

## Budget

~30–45 min. Target 10–30 high-quality findings. Quality > quantity.
