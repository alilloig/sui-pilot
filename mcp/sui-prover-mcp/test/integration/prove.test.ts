/**
 * Integration test: spawn the real sui-prover binary against the
 * `tiny` fixture and assert the wrapper returns the expected JSON
 * shape. Skipped when the binary isn't on PATH so CI without
 * sui-prover doesn't fail.
 *
 * This test does NOT strictly assert `verified > 0` because the prover
 * can fail for environment reasons unrelated to the wrapper
 * (e.g. boogie/z3 missing, network issues fetching the prover Move
 * package). The wrapper-correctness signal is "we got a structured
 * response, including raw_stdout/raw_stderr as the fallback". Manual
 * smoke + the /specify evals (phase 4) provide the prover-correctness
 * signal.
 */

import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { discoverBinary } from '../../src/binary.js';
import { prove } from '../../src/prove.js';
import { listSpecs } from '../../src/list-specs.js';
import { capabilities } from '../../src/capabilities.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'tiny');

const hasBinary = discoverBinary() !== null;
const itIfBinary = hasBinary ? it : it.skip;

describe('integration: sui-prover MCP wrapper', () => {
  it('list_specs finds the colocated spec in the fixture', () => {
    const result = listSpecs(FIXTURE);
    expect(result.files_scanned).toBeGreaterThan(0);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]!.function_name).toBe('safe_increment_spec');
    expect(result.specs[0]!.attrs).toContain('prove');
  });

  it('prover_capabilities reports binary state and Move.toml setup', () => {
    const caps = capabilities({ move_toml_path: FIXTURE });
    expect(caps.binary.found).toBe(hasBinary);
    expect(caps.setup_warnings.find((w) => w.kind === 'missing_movetoml')).toBeUndefined();
    // Tiny fixture has no explicit Sui/MoveStdlib deps.
    expect(caps.setup_warnings.find((w) => w.kind === 'explicit_framework_dep')).toBeUndefined();
  });

  // Round-trip the wrapper's prove() against the tiny fixture. Skipped
  // when the binary is missing AND when SKIP_PROVER_NETWORK=1 is set --
  // the first invocation on a fresh checkout clones the sui-prover Move
  // dep into ~/.move and downloads framework crates (a one-off ~30-60s
  // cost). CI without network or with a stricter time budget should
  // export SKIP_PROVER_NETWORK=1.
  const itIfWarm =
    hasBinary && process.env['SKIP_PROVER_NETWORK'] !== '1' ? it : it.skip;

  itIfWarm(
    'prove() returns the structured response shape /specify consumes',
    async () => {
      const result = await prove({ path: FIXTURE, timeout_seconds: 90 });
      expect(result.binary.path).toMatch(/sui-prover$/);
      expect(result.binary.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(result.package.name).toBe('tiny');
      expect(result.package.edition).toMatch(/^2024/);
      expect(result.invocation.args).toContain('--path');
      expect(result.invocation.args).toContain('--timeout');
      expect(typeof result.invocation.duration_ms).toBe('number');
      expect(result.invocation.duration_ms).toBeGreaterThan(0);
      expect(Array.isArray(result.findings)).toBe(true);
      expect(typeof result.raw_stdout).toBe('string');
      expect(typeof result.raw_stderr).toBe('string');
      // The tiny fixture's safe_increment_spec verifies cleanly on a
      // warm cache -- assert that here so we catch parser regressions
      // that would mask a real success as "failed".
      expect(result.summary.failed).toBe(0);
    },
    180_000
  );
});

void itIfBinary;
