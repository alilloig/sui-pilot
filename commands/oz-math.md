---
name: oz-math
description: Analyze Move package for arithmetic that could use OpenZeppelin math contracts
---

Invoke the `oz-math` skill to analyze the Move package in the current directory for arithmetic patterns that could be improved using OpenZeppelin math contracts.

## What This Command Does

- Scans Move source files for arithmetic anti-patterns (overflow-prone multiply-divide, unchecked shifts, manual scaling)
- Uses Move LSP to verify operand types and match to correct OZ module (u64, u128, u256)
- Recommends specific OpenZeppelin functions with complete code fixes
- Produces severity-scored findings with file:line references

## When to Use

- Before deploying DeFi code that handles token amounts, prices, or rates
- When you see `/move-code-review` SEC-AR-* findings and want concrete fixes
- After adding arithmetic logic to pools, oracles, AMMs, or vaults
- When manually implementing math that might have library support

## Related Commands

- `/move-code-review` — Flags SEC-AR-* arithmetic security issues (this skill provides the fixes)
- `/move-code-quality` — Style and idiom analysis (run before oz-math)
- `/move-tests` — Generate tests after applying oz-math recommendations
