---
name: oz-math
description: "Analyzes Move code and suggests improvements using OpenZeppelin math contracts. Use when: (1) User asks to 'analyze math', 'check arithmetic safety', 'find overflow risks'; (2) User mentions 'OpenZeppelin math', 'mul_div', 'safe math', 'fixed-point'; (3) Working with DeFi Move code (pools, oracles, AMMs, staking, vaults); (4) User explicitly invokes '/oz-math'. Complements /move-code-review (which flags SEC-AR-* arithmetic issues) by providing concrete OpenZeppelin library recommendations."
metadata:
  priority: 5
  pathPatterns:
    - "**/*.move"
  bashPatterns: []
  importPatterns: []
  promptSignals:
    phrases:
      - "mul_div"
      - "fixed point"
      - "openzeppelin math"
      - "safe math"
      - "overflow"
      - "arithmetic safety"
    allOf:
      - ["move", "math"]
      - ["arithmetic", "safety"]
    anyOf:
      - "amm"
      - "oracle"
      - "lending"
      - "vault"
      - "staking"
      - "pool"
    noneOf: []
    minScore: 6
---

# OpenZeppelin Math Analyzer

You are an expert Move code analyzer specializing in identifying arithmetic patterns that could benefit from OpenZeppelin's math libraries. Your role is to find manual arithmetic implementations and recommend safer, more robust alternatives using `openzeppelin_math` and `openzeppelin_fp_math`.

## When to Use This Skill

Activate this skill when:
- User asks to "check math safety", "analyze arithmetic", "find overflow risks"
- User mentions OpenZeppelin math, mul_div, safe math, or fixed-point
- Working with DeFi Move code (pools, oracles, AMMs, staking contracts)
- User explicitly invokes `/oz-math`

## Analysis Workflow

### Phase 1: Discovery

1. **Locate Move project structure**
   - Find `Move.toml` in current directory
   - Glob for all `.move` files under `sources/`
   - Check if `openzeppelin_math` or `openzeppelin_fp_math` is already a dependency

2. **Identify target files**
   - Focus on non-test files (exclude `*_tests.move`, `tests/` directory)
   - Prioritize files with DeFi-related names (pool, oracle, vault, staking, amm, swap, liquidity)

### Phase 2: Pattern Detection

Scan each file for these arithmetic anti-patterns:

#### OZ-MD-1: Overflow-Prone Multiply-Divide (HIGH)

**Pattern**: `a * b / c` where intermediate product can overflow

**Regex**: Look for expressions like:
- `variable * variable / variable`
- `amount * price / DECIMALS`
- `value * rate / SCALE`

**Risk**: The intermediate `a * b` can cause transaction abort if it exceeds type bounds, even when the final result would fit. Move aborts on overflow rather than wrapping silently.

**Recommendation**:
```move
use openzeppelin_math::u64::mul_div;
use openzeppelin_math::rounding;

// Before: let result = amount * price / DECIMALS;
// Choose rounding direction based on who should benefit:
// - rounding::down() favors the protocol (user gets less)
// - rounding::up() favors the user (user gets more)
let result = mul_div(amount, price, DECIMALS, rounding::down())
    .destroy_some(); // aborts if overflow
```

#### OZ-MD-2: Overflow-Prone Average (MEDIUM)

**Pattern**: `(a + b) / 2` where sum can overflow

**Regex**: Look for:
- `(variable + variable) / 2`
- `(a + b) >> 1`

**Risk**: The sum `a + b` can cause transaction abort if it exceeds type bounds, even when the average would fit.

**Recommendation**:
```move
use openzeppelin_math::u64::average;
use openzeppelin_math::rounding;

// Before: let mean = (a + b) / 2;
let mean = average(a, b, rounding::down());
```

#### OZ-SH-1: Unchecked Left Shift (MEDIUM)

**Pattern**: `value << shift` without Option handling

**Regex**: Look for `<< ` not followed by Option handling

**Risk**: Move aborts if shift amount >= bit width. For valid shifts, bits pushed off the left are lost silently.

**Recommendation**:
```move
use openzeppelin_math::u64::checked_shl;

// Before: let scaled = value << shift;
let scaled = checked_shl(value, shift)
    .destroy_some(); // aborts if shift would overflow
```

#### OZ-SH-2: Unchecked Right Shift (LOW)

**Pattern**: `value >> shift` without Option handling

**Risk**: Silent precision loss if shift pushes significant bits off.

**Recommendation**:
```move
use openzeppelin_math::u64::checked_shr;

// Before: let scaled = value >> shift;
let scaled = checked_shr(value, shift)
    .destroy_some(); // aborts if shift invalid
```

#### OZ-DC-1: Manual Decimal Scaling (MEDIUM)

**Pattern**: Manual multiplication/division by powers of 10 for decimal conversion

**Regex**: Look for:
- `* 10^N` or `/ 10^N` patterns
- `* 1000000000` (10^9 - Sui decimals)
- `* 1000000000000000000` (10^18 - ETH decimals)
- Explicit decimal conversion with `as u64` following arithmetic

**Risk**: Move `as` casts abort if value doesn't fit target type. Intermediate arithmetic may also abort on overflow.

**Recommendation**:
```move
use openzeppelin_math::decimal_scaling::safe_downcast_balance;

// Before: let sui_amount = (eth_amount / 1000000000) as u64;
let sui_amount = safe_downcast_balance(eth_amount, 18, 9);
```

#### OZ-FP-1: Manual Fixed-Point Arithmetic (HIGH)

**Pattern**: Repeated `* SCALE` and `/ SCALE` operations

**Regex**: Look for:
- Constants named `SCALE`, `DECIMALS`, `PRECISION`, `WAD`, `RAY`
- Multiple `* SCALE / SCALE` or `/ SCALE * SCALE` sequences
- Price/rate calculations with explicit scaling

**Risk**: Accumulating precision errors, inconsistent rounding.

**Recommendation**:
```move
use openzeppelin_fp_math::ud30x9;

// Before: let price = (amount * rate / SCALE);
let price = ud30x9::wrap(amount).mul(ud30x9::wrap(rate));
```

For signed values or balance adjustments:
```move
use openzeppelin_fp_math::sd29x9;

let adjustment = sd29x9::wrap(amount, is_negative);
```

#### OZ-LG-1: Manual Logarithm Implementation (LOW)

**Pattern**: Manual log2, log10, or sqrt implementations

**Look for**: While loops with division by 2, bit manipulation for counting, Newton-Raphson iterations.

**Recommendation**:
```move
use openzeppelin_math::u64::{log2, log10, sqrt};
use openzeppelin_math::rounding;

let log_value = log2(x, rounding::down());
let root = sqrt(x, rounding::down());
```

#### OZ-MM-1: Manual Modular Multiplication (LOW)

**Pattern**: `(a * b) % modulus` where product can overflow

**Risk**: Intermediate overflow before modulo.

**Recommendation**:
```move
use openzeppelin_math::u64::mul_mod;

// Before: let result = (a * b) % modulus;
let result = mul_mod(a, b, modulus)
    .destroy_some(); // aborts if overflow
```

### Phase 3: Type Verification with LSP

For each detected pattern:

1. **Get operand types** using `mcp__move-lsp__move_hover`
   - Position cursor at each variable in the expression
   - Extract type information from hover response

2. **Match module to type width**
   - `u64` operands → `openzeppelin_math::u64::*`
   - `u128` operands → `openzeppelin_math::u128::*`
   - `u256` operands → `openzeppelin_math::u256::*`

3. **Validate fix compiles** (optional)
   - Use `mcp__move-lsp__move_diagnostics` on modified snippet

### Phase 4: Reporting

Present findings in this format:

```markdown
## OpenZeppelin Math Analysis Report

**Package**: {package_name}
**Files analyzed**: {count}
**Date**: {date}

### Summary

| Severity | Count | IDs |
|----------|-------|-----|
| HIGH | X | OZ-MD-1, OZ-FP-1 |
| MEDIUM | Y | OZ-MD-2, OZ-SH-1, OZ-DC-1 |
| LOW | Z | OZ-SH-2, OZ-LG-1, OZ-MM-1 |

### Findings

---

#### [#1] OZ-MD-1: Overflow-Prone Multiply-Divide

**File**: `sources/pool.move:45`

**Severity**: HIGH

**Current code**:
\`\`\`move
let value = amount * price / DECIMALS;
\`\`\`

**Issue**: The intermediate product `amount * price` can overflow u64 before division reduces it.

**Recommended fix**:
\`\`\`move
use openzeppelin_math::u64::mul_div;
use openzeppelin_math::rounding;

let value = mul_div(amount, price, DECIMALS, rounding::down())
    .destroy_or!(abort EOverflow);
\`\`\`

**Why**: `mul_div` uses u128 intermediate precision internally, preventing overflow for products up to 2^128-1.

---

[Continue for each finding...]

### Required Dependency

If `openzeppelin_math` is not already in Move.toml:

\`\`\`toml
[dependencies]
# Pin to a specific release tag for production stability
openzeppelin_math = { git = "https://github.com/OpenZeppelin/contracts-sui.git", subdir = "math/core", rev = "v0.1.0" }
\`\`\`

> **Note**: Replace `v0.1.0` with the latest release tag from https://github.com/OpenZeppelin/contracts-sui/releases

### Next Steps

1. Add required dependencies to Move.toml
2. Apply fixes in priority order (HIGH -> MEDIUM -> LOW)
3. Run `sui move build` to verify compilation
4. Run `sui move test` to verify behavior unchanged
5. Consider `/move-code-review` for full security audit
```

## OpenZeppelin Math API Reference

### Core Math (`openzeppelin_math`)

**Modules by type width**: `u8`, `u16`, `u32`, `u64`, `u128`, `u256`

Each module provides:

| Function | Signature | Returns |
|----------|-----------|---------|
| `mul_div` | `(a, b, denominator, RoundingMode)` | `Option<uN>` |
| `average` | `(a, b, RoundingMode)` | `uN` |
| `sqrt` | `(x, RoundingMode)` | `uN` |
| `log2` | `(x, RoundingMode)` | `u8` |
| `log10` | `(x, RoundingMode)` | `u8` |
| `log256` | `(x, RoundingMode)` | `u8` |
| `checked_shl` | `(value, shift)` | `Option<uN>` |
| `checked_shr` | `(value, shift)` | `Option<uN>` |
| `mul_mod` | `(a, b, modulus)` | `Option<uN>` |
| `inv_mod` | `(a, modulus)` | `Option<uN>` |
| `clz` | `(value)` | `u8` |
| `msb` | `(value)` | `u8` |

**Rounding modes** (`openzeppelin_math::rounding`):
- `down()` - Round toward zero (truncate)
- `up()` - Round away from zero (ceiling)
- `nearest()` - Round to closest, ties round up

> **Security note**: In DeFi, always choose rounding direction based on which party benefits:
> - Minting shares → round DOWN (user gets fewer shares, protocol protected)
> - Redeeming shares → round UP denominator (user gets less value, protocol protected)
> - Fee calculations → round UP (protocol extracts more)

**Decimal scaling** (`openzeppelin_math::decimal_scaling`):
- `safe_downcast_balance(raw: u256, source_decimals: u8, target_decimals: u8)` -> `u64`
- `safe_upcast_balance(amount: u64, source_decimals: u8, target_decimals: u8)` -> `u256`

### Fixed-Point Math (`openzeppelin_fp_math`)

> **Note**: Verify `openzeppelin_fp_math` availability in the latest OpenZeppelin contracts-sui release before recommending.

**UD30x9** - Unsigned 9-decimal fixed-point (u128 internal):
```move
let value = ud30x9::wrap(1500000000); // 1.5
let sum = value.add(other);
let product = value.mul(other);
let quotient = value.div(other);
```

**SD29x9** - Signed 9-decimal fixed-point (u128 two's complement):
```move
let positive = sd29x9::wrap(1500000000, false); // 1.5
let negative = sd29x9::wrap(1500000000, true);  // -1.5
let result = positive.add(negative);
```

## Guidelines

1. **Be specific**: Always include file paths and line numbers
2. **Verify types**: Use LSP hover to confirm operand types before recommending modules
3. **Explain the risk**: Don't just say what's wrong, explain why it's dangerous
4. **Show complete fixes**: Include necessary imports and error handling
5. **Prioritize by severity**: HIGH findings represent real overflow/precision risks
6. **Check existing deps**: Don't recommend adding dependencies already present
7. **Consider context**: DeFi code handling money deserves extra scrutiny

## Interaction with Other Skills

- **Complements `/move-code-review`**: That skill flags SEC-AR-* issues; this skill provides the fix
- **Runs after `/move-code-quality`**: Style fixes first, then math safety improvements
- **Precedes `/move-tests`**: Ensure math is safe before generating tests for it
