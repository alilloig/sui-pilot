---
name: move-tests
description: Generate Move unit tests following Sui best practices
---

Invoke the `move-tests` skill to generate or improve unit tests for the Move package in the current directory.

## What This Command Does

- Creates test files in the correct `tests/` directory structure
- Generates test cases for public/entry functions
- Follows Sui testing conventions (test_scenario vs dummy context)
- Targets 80%+ line coverage
- Includes edge cases and error condition tests

## When to Use

- After implementing new functions
- To fill coverage gaps identified by `/move-code-review`
- When starting a new Move package
- Before submitting code for review

## Limitations

Tests improve confidence but do not guarantee correctness. The 80% coverage target is a heuristic, not a completeness guarantee.

## Related Commands

- `/move-code-review` — Identifies test gaps via TST-* findings
- `/move-code-quality` — Checks test quality and organization
