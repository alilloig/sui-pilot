import { describe, it, expect } from 'vitest';
import { parseSupportedFlags } from '../../src/binary.js';

const HELP_FIXTURE = `Command-line tool for formal verification of Move code within Sui projects.

Usage: sui-prover [OPTIONS]

Options:
  -p, --path <PACKAGE_PATH>            Path to package directory with a Move.toml inside
  -b, --boogie-config <BOOGIE_CONFIG>  Boggie options
  -h, --help                           Print help
  -V, --version                        Print version

General Options:
  -t, --timeout <timeout>              Set verification timeout in seconds (default: 3000)
      --force-timeout                  Force kill boogie process if boogie vc timeout is broken
  -k, --keep-temp                      Don't delete temporary files after verification
  -g, --generate-only                  Only generate Boogie code
  -v, --verbose                        Display detailed verification progress
      --no-counterexample-trace        Don't display counterexample trace
      --explain                        Explain the proving outputs via LLM
      --use_array_theory               Display detailed verification progress
  -s, --split-paths <split-paths>      Split verification into separate proof goals for each execution path
      --no-bv-int-encoding             Encode u8..u256 as bitvector instead of integer in boogie

Filtering Options:
      --modules <MODULES>              Specify modules names to target
      --functions <FUNCTIONS>          Specify functions names to target

Remote Options:
      --cloud                          Use cloud configuration from file
      --cloud-config-path <PATH>       Path to cloud configuration file
      --cloud-config                   Create/update cloud configuration file interactively
`;

describe('parseSupportedFlags', () => {
  it('extracts expected long flags from the 1.5.3 --help fixture', () => {
    const flags = parseSupportedFlags(HELP_FIXTURE);
    expect(flags).toContain('--path');
    expect(flags).toContain('--timeout');
    expect(flags).toContain('--functions');
    expect(flags).toContain('--modules');
    expect(flags).toContain('--verbose');
    expect(flags).toContain('--cloud');
    expect(flags).toContain('--split-paths');
    expect(flags).toContain('--keep-temp');
  });

  it('deduplicates flags appearing in multiple sections', () => {
    const dup = `--foo --foo --foo`;
    expect(parseSupportedFlags(dup)).toEqual(['--foo']);
  });

  it('returns sorted output for deterministic comparisons', () => {
    const flags = parseSupportedFlags(HELP_FIXTURE);
    const sorted = [...flags].sort();
    expect(flags).toEqual(sorted);
  });

  it('does not extract short flags', () => {
    const flags = parseSupportedFlags(HELP_FIXTURE);
    expect(flags.some((f) => f === '-p' || f === '-t')).toBe(false);
  });
});
