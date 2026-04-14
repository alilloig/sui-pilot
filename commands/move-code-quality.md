---
name: move-code-quality
description: Analyze Move package syntax, idioms, and Move 2024 Edition compliance
---

Invoke the `move-code-quality` skill to analyze the Move package in the current directory.

## What This Command Does

- Checks 50+ rules from the Move Book Code Quality Checklist
- Validates Move 2024 Edition syntax and conventions
- Reviews package manifest (Move.toml) configuration
- Identifies outdated patterns and suggests modern alternatives

## When to Use

- After writing new Move code
- Before committing changes
- When migrating to Move 2024 Edition
- For routine code hygiene checks

## Related Commands

- `/move-code-review` — Security and architecture analysis (different scope)
- `/move-tests` — Generate unit tests for identified gaps
