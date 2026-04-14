---
name: move-code-review
description: Security, architecture, and design review for Sui Move smart contracts
---

Invoke the `move-code-review` skill to perform a security and architecture review of the Move package in the current directory.

## What This Command Does

- Audits 40 checks across 6 categories (security, design, patterns, testing, quality, configuration)
- Reviews access control, arithmetic safety, object ownership
- Identifies shared object congestion risks
- Flags missing test coverage gaps
- Produces severity-scored findings (S1-Critical to S4-Low)

## When to Use

- Before deploying to mainnet
- During pre-audit preparation
- When reviewing untrusted code
- For security-focused PR reviews

## Related Commands

- `/move-code-quality` — Syntax and idiom analysis (different scope)
- `/move-tests` — Generate tests for TST-* findings from this review
