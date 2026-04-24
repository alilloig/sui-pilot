---
name: move-pr-review
description: Multi-agent deep PR review for Sui Move packages — 10 parallel reviewers + 1 consolidator
---

Invoke the `move-pr-review` skill to perform a deep, multi-agent review of a Sui Move pull request.

## What This Command Does

- Dispatches 10 `sui-pilot-agent` reviewers in parallel, each independently running `/move-code-review` + `/move-code-quality` on the in-scope Move and cross-checking integration boundaries against upstream Move dependencies.
- Validates and clusters the reviewers' strict-schema JSON findings.
- Dispatches 1 `sui-pilot-agent` consolidator that verifies high-severity claims against the source code, splits mega-clusters, and writes the final Markdown deliverable.
- Produces `reviews/<TICKET-ID>-<feature>-review.md` with severity counts, agreement counts, evidence quotes, and a methodology / postscript section.

## When to Use

- Pre-audit / pre-mainnet PR review at audit-readiness quality.
- Partner-facing Move consultation requests.
- Any non-trivial Move PR (≥ ~100 lines of Move diff or any new module) where a single `/move-code-review` pass isn't enough.

## When NOT to Use

- Trivial PRs (< ~50 lines of Move diff, no new modules) — use `/move-code-review` directly.
- Pure off-chain TypeScript reviews — use `pr-review-toolkit:review-pr` instead.
- Single-file syntax checks — use `/move-code-quality`.

## Cost Shape

~25–40 minutes wall clock. ~10 reviewer-tokens-budgets in parallel + 1 consolidator. The redundancy and verification meaningfully reduces false positives compared to a single-pass review — pay for it only when audit-readiness matters.

## Related Commands

- `/move-code-review` — single-pass security review (the skill each reviewer invokes).
- `/move-code-quality` — Move 2024 idiom checker (the skill each reviewer invokes).
- `/move-tests` — follow-up after the review identifies test gaps.
- `/sui-pilot` — doc-first entry point; routes to the sui-pilot-agent for ad-hoc Move work.
