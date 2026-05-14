import { describe, it, expect } from 'vitest';
import { findSpecsInSource, stripComments } from '../../src/list-specs.js';

const SAMPLE = `module amm::pool;

public fun deposit<A, B>(pool: &mut Pool<A, B>, a: Balance<A>): Balance<LP<A, B>> {
    // ... body
    abort 0
}

// specs

#[spec_only]
use prover::prover::{requires, ensures, asserts};

#[spec(prove)]
fun deposit_spec<A, B>(pool: &mut Pool<A, B>, a: Balance<A>): Balance<LP<A, B>> {
    deposit(pool, a)
}

#[spec(prove, no_opaque)]
fun internal_swap_spec(x: u64): u64 {
    internal_swap(x)
}

#[spec(prove, target = amm::pool::admin_set_fees, boogie_opt = b"vcsMaxKeepGoingSplits:2")]
public fun admin_set_fees_spec<A, B>(
    pool: &mut Pool<A, B>,
    cap: &AdminCap,
    lp_fee_bps: u64,
    admin_fee_pct: u64,
) {
    abort 0
}

// This one is commented out -- must NOT appear as a live spec.
// #[spec(prove)]
// fun commented_out_spec() {}
`;

describe('findSpecsInSource', () => {
  it('finds colocated specs and extracts attrs', () => {
    const stripped = stripComments(SAMPLE);
    const specs = findSpecsInSource(stripped, '/abs/pool.move');
    expect(specs.length).toBe(3);
    expect(specs.map((s) => s.function_name)).toEqual([
      'deposit_spec',
      'internal_swap_spec',
      'admin_set_fees_spec',
    ]);
  });

  it('captures the target= attribute', () => {
    const specs = findSpecsInSource(stripComments(SAMPLE), '/abs/pool.move');
    const adminSetFees = specs.find((s) => s.function_name === 'admin_set_fees_spec');
    expect(adminSetFees?.target).toBe('amm::pool::admin_set_fees');
  });

  it('captures hex-address targets (regression: R3-001 / R1-003)', () => {
    // The Asymptotic guide explicitly recommends `target = 0x2::...` for
    // specs that target framework functions. The earlier `[A-Za-z_][\w:]*`
    // regex rejected the hex prefix and produced `target: null` for these
    // -- which broke /specify's idempotency check.
    const src = `module x::y;
#[spec(prove, target = 0x2::transfer::public_transfer)]
public fun framework_spec<T: key>(obj: T, recipient: address) {
    0x2::transfer::public_transfer(obj, recipient)
}
`;
    const specs = findSpecsInSource(stripComments(src), '/abs/x.move');
    expect(specs).toHaveLength(1);
    expect(specs[0]!.target).toBe('0x2::transfer::public_transfer');
  });

  it('captures multi-digit hex-address targets', () => {
    const src = `#[spec(prove, target = 0x42a::mod::fn)]
public fun ok_spec() { abort 0 }
`;
    const specs = findSpecsInSource(stripComments(src), '/abs/x.move');
    expect(specs[0]!.target).toBe('0x42a::mod::fn');
  });

  it('preserves boogie_opt verbatim in attrs', () => {
    const specs = findSpecsInSource(stripComments(SAMPLE), '/abs/pool.move');
    const adminSetFees = specs.find((s) => s.function_name === 'admin_set_fees_spec');
    expect(adminSetFees?.attrs.some((a) => a.startsWith('boogie_opt='))).toBe(true);
  });

  it('records line numbers correctly', () => {
    const stripped = stripComments(SAMPLE);
    const specs = findSpecsInSource(stripped, '/abs/pool.move');
    const sortedByLine = [...specs].sort((a, b) => a.line - b.line);
    expect(sortedByLine).toEqual(specs);
    expect(specs[0]!.line).toBeGreaterThan(1);
  });

  it('ignores commented-out spec annotations', () => {
    const stripped = stripComments(SAMPLE);
    const specs = findSpecsInSource(stripped, '/abs/pool.move');
    expect(specs.find((s) => s.function_name === 'commented_out_spec')).toBeUndefined();
  });
});

describe('stripComments', () => {
  it('preserves line numbers when removing block comments', () => {
    const input = `line1\n/* block\n  spans\n  three */\nline5`;
    const stripped = stripComments(input);
    // Each preserved \n keeps line count stable
    expect(stripped.split('\n').length).toBe(input.split('\n').length);
  });

  it('removes inline // comments', () => {
    const stripped = stripComments('let x = 1; // suspicious');
    expect(stripped).not.toContain('suspicious');
  });
});
