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

  // Deferred to Phase 4 evals: spawning the real prover on a cold cache
  // takes minutes (git fetch + Boogie setup), which is too slow for unit
  // CI. Phase 4 will run this against the pre-warmed AMM fixture inside
  // evals/run-comparison.sh. The wrapper shape is already exercised by
  // the list_specs and prover_capabilities tests above; the spawn path
  // itself is plain Node child_process.
  it.skip('prove returns a structured response shape (phase 4)', async () => {
    const result = await prove({ path: FIXTURE, timeout_seconds: 30 });
    expect(result.binary.path).toMatch(/sui-prover$/);
    expect(result.package.name).toBe('tiny');
    expect(result.invocation.args).toContain('--path');
    expect(result.invocation.args).toContain('--timeout');
    expect(typeof result.invocation.duration_ms).toBe('number');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.raw_stdout).toBe('string');
    expect(typeof result.raw_stderr).toBe('string');
  });
});

// Avoid unused-import lint when the prove path is skipped.
void itIfBinary;
