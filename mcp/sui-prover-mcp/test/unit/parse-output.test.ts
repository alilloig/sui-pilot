import { describe, it, expect } from 'vitest';
import { parseProverOutput } from '../../src/parse-output.js';

describe('parseProverOutput', () => {
  it('reports zero findings on a clean run', () => {
    const stdout = `Verifying amm::pool::deposit_spec
3 specs verified`;
    const result = parseProverOutput(stdout, '', 0);
    expect(result.summary.verified).toBe(3);
    expect(result.summary.failed).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('classifies an ensures failure with location', () => {
    const stderr = `Verifying amm::pool::withdraw_spec
FAILED: amm::pool::withdraw_spec
  ensures may not hold: new_L.lte(new_A.mul(new_B))
  at /abs/amm/sources/pool.move:412:5
`;
    const result = parseProverOutput('', stderr, 1);
    expect(result.summary.failed).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.kind).toBe('ensures_failed');
    expect(result.findings[0]!.spec).toBe('amm::pool::withdraw_spec');
    expect(result.findings[0]!.function_under_test).toBe('amm::pool::withdraw');
    expect(result.findings[0]!.location).toEqual({
      file: '/abs/amm/sources/pool.move',
      line: 412,
      col: 5,
    });
  });

  it('classifies an asserts failure', () => {
    const stderr = `FAILED: amm::pool::admin_set_fees_spec
  asserts may not hold: lp_fee_bps < BPS_IN_100_PCT
`;
    const result = parseProverOutput('', stderr, 1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.kind).toBe('asserts_failed');
    expect(result.findings[0]!.spec).toBe('amm::pool::admin_set_fees_spec');
  });

  it('detects timeouts and counts them separately from failed', () => {
    const stderr = `Verifying foo_spec
sui-prover: verification timed out (60s)
`;
    const result = parseProverOutput('', stderr, 1);
    expect(result.summary.timeouts).toBe(1);
    expect(result.summary.failed).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.kind).toBe('timeout');
  });

  it('flags compile and parse errors before verification', () => {
    const stderr = `error: cannot resolve module 'prover::prover'
  at /pkg/sources/foo.move:3:5
`;
    const result = parseProverOutput('', stderr, 1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.kind).toBe('compile_error');
    expect(result.findings[0]!.location?.file).toBe('/pkg/sources/foo.move');
  });

  it('surfaces an unknown finding on non-zero exit with empty parse', () => {
    const result = parseProverOutput('', '', 137);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.kind).toBe('unknown');
    expect(result.findings[0]!.message).toContain('137');
  });

  it('extracts a counterexample block when present', () => {
    const stderr = `FAILED: amm::pool::swap_b_spec
  ensures may not hold: ...
  at /pkg/sources/pool.move:520:3
  Counterexample:
    old_L = 2
    new_L = 5
    a_in = 100
`;
    const result = parseProverOutput('', stderr, 1);
    const f = result.findings[0]!;
    expect(f.counterexample).not.toBeNull();
    expect(f.counterexample?.bindings).toMatchObject({
      old_L: '2',
      new_L: '5',
      a_in: '100',
    });
  });
});
