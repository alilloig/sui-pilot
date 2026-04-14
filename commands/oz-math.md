---
name: oz-math
description: Analyze Move package for arithmetic that could use OpenZeppelin math contracts
---

Invoke the `oz-math` skill to analyze the Move package in the current directory for arithmetic patterns that could be improved using OpenZeppelin math contracts (`openzeppelin_math`, `openzeppelin_fp_math`).

The skill will:
1. Find all Move source files in the package
2. Detect arithmetic anti-patterns (overflow-prone multiply-divide, unchecked shifts, manual scaling)
3. Use Move LSP to verify operand types
4. Recommend specific OpenZeppelin functions with complete code fixes
