import { describe, it, expect } from 'vitest';
import { parseProverOutput, stripAnsi } from '../../src/parse-output.js';

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

  it('parses 1.5.3 ✅ verified lines into summary.verified (dedups subchecks)', () => {
    // The 1.5.3 prover emits 3 subchecks per spec (_Check, _Assume,
    // _SpecNoAbortCheck) plus one _SpecNoAbortCheck per axiom file. Input
    // below has 1 spec (calc_invariant_full_spec) with 2 of its 3 subchecks
    // visible + 1 axiom-file marker, representing the spec count of 2 unique
    // specs (one spec function + one axiom-file marker collapse to two base
    // names after suffix stripping).
    const stdout = `🔄 0x15::specify_axioms_SpecNoAbortCheck
✅ 0x15::specify_axioms_SpecNoAbortCheck
🔄 amm_math::geometric_mean_calculations::calc_invariant_full_spec_Check
✅ amm_math::geometric_mean_calculations::calc_invariant_full_spec_Check
✅ amm_math::geometric_mean_calculations::calc_invariant_full_spec_Assume
✅ amm_math::geometric_mean_calculations::calc_invariant_full_spec_SpecNoAbortCheck
Verification successful
`;
    const result = parseProverOutput(stdout, '', 0);
    // 2 unique base spec names: `0x15::specify_axioms` (after stripping
    // _SpecNoAbortCheck) and `amm_math::...::calc_invariant_full_spec` (after
    // stripping all 3 subcheck suffixes). NOT 4 — that would be the bug this
    // test guards against (counting per-subcheck instead of per-spec).
    expect(result.summary.verified).toBe(2);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.overall).toBe('verified_all');
    // No findings emitted for verified specs — count is the signal.
    expect(result.findings.filter((f) => f.kind === 'verified')).toHaveLength(0);
  });

  it('dedups ❌ failed subchecks into one finding per unique base spec', () => {
    const stdout = `❌ pkg::mod::bad_spec_Check at /abs/path/foo.move:42:3
❌ pkg::mod::bad_spec_Assume at /abs/path/foo.move:42:3
❌ pkg::mod::bad_spec_SpecNoAbortCheck at /abs/path/foo.move:42:3
Verification failed
`;
    const result = parseProverOutput(stdout, '', 1);
    expect(result.summary.failed).toBe(1);
    expect(result.findings.filter((f) => f.kind === 'failed')).toHaveLength(1);
    expect(result.findings.find((f) => f.kind === 'failed')?.spec).toBe('pkg::mod::bad_spec');
  });

  it('parses ⏭️ skipped lines as info-severity findings', () => {
    const stdout = `⏭️ specify_axioms::mul_down_spec at ./sources/specify_axioms.move:27
⏭️ specify_axioms::mul_up_spec at ./sources/specify_axioms.move:32
Verification successful
`;
    const result = parseProverOutput(stdout, '', 0);
    expect(result.summary.skipped).toBe(2);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]!.kind).toBe('skipped');
    expect(result.findings[0]!.severity).toBe('info');
    expect(result.findings[0]!.location).toEqual({
      file: './sources/specify_axioms.move',
      line: 27,
      col: 0,
    });
  });

  it('parses ❌ failed lines and assigns the failed kind', () => {
    const stdout = `❌ pkg::mod::bad_spec_Check at /abs/path/foo.move:42:3
Verification failed
`;
    const result = parseProverOutput(stdout, '', 1);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.overall).toBe('failed_some');
    const failed = result.findings.find((f) => f.kind === 'failed');
    expect(failed?.spec).toBe('pkg::mod::bad_spec');
    expect(failed?.location).toEqual({ file: '/abs/path/foo.move', line: 42, col: 3 });
  });

  it('strips ANSI escape codes before matching', () => {
    const ansified = '[1A[2K✅ pkg::mod::foo_spec_Check\n';
    expect(stripAnsi(ansified)).toBe('✅ pkg::mod::foo_spec_Check\n');
    const result = parseProverOutput(ansified, '', 0);
    expect(result.summary.verified).toBe(1);
  });

  it('reports dep_address_conflict on conflicting address assignments', () => {
    const stdout = `Unable to resolve named address 'utilities' in package 'AftermathAmmMath' when resolving dependencies in dev mode

Caused by:
    Conflicting assignments for address 'utilities': '0x73baa782c55003b3a359dec04b189312565d18e7309d4a51f5f112f891e3b2ab' and '0x10'.
`;
    const result = parseProverOutput(stdout, '', 1);
    expect(result.summary.overall).toBe('compile_failure');
    const conflict = result.findings.find((f) => f.kind === 'dep_address_conflict');
    expect(conflict).toBeDefined();
    expect(conflict?.message).toContain("utilities");
    expect(conflict?.message).toContain('0x73baa782');
  });

  it('reports dep_fetch_failure on private/missing repo', () => {
    const stderr = `output from \`git ls-remote -- git@github.com:AftermathFinance/utilities.git refs/tags/main\`
ERROR: Repository not found.
fatal: Could not read from remote repository.
`;
    const result = parseProverOutput('', stderr, 1);
    expect(result.summary.overall).toBe('compile_failure');
    const fetch = result.findings.find((f) => f.kind === 'dep_fetch_failure');
    expect(fetch).toBeDefined();
    expect(fetch?.message).toContain('AftermathFinance/utilities.git');
  });

  it('reports function_not_found when --functions target is missing', () => {
    const stdout = `Function \`amm_math::geometric_mean_calculations::calc_invariant_full\` does not exist\n`;
    const result = parseProverOutput(stdout, '', 1);
    expect(result.summary.overall).toBe('compile_failure');
    const f = result.findings.find((x) => x.kind === 'function_not_found');
    expect(f?.function_under_test).toBe('amm_math::geometric_mean_calculations::calc_invariant_full');
  });

  it('reports spec_target_body_no_call when the spec body misses its target', () => {
    const stderr = `error: Spec function \`specify_axioms::mul_up_spec\` should call target function \`fixed::mul_up\`
   ┌─ ./sources/specify_axioms.move:33:5
`;
    const result = parseProverOutput('', stderr, 1);
    const f = result.findings.find((x) => x.kind === 'spec_target_body_no_call');
    expect(f?.spec).toBe('specify_axioms::mul_up_spec');
    expect(f?.function_under_test).toBe('fixed::mul_up');
    expect(f?.message).toContain('skip, target = fixed::mul_up');
  });

  it('reports no_specs_to_prove on the prover\'s "nothing to verify" banner', () => {
    const stdout = `🦀 No specifications are marked for verification. Nothing to verify.\n`;
    const result = parseProverOutput(stdout, '', 0);
    expect(result.summary.overall).toBe('no_specs');
    expect(result.findings.find((f) => f.kind === 'no_specs_to_prove')).toBeDefined();
  });

  it('sets summary.overall = verified_all on a clean exit with verifications', () => {
    const result = parseProverOutput('✅ a::b::c_spec_Check\nVerification successful\n', '', 0);
    expect(result.summary.overall).toBe('verified_all');
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
