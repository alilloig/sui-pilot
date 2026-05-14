/**
 * Integration test: exercise prove() against a mock sui-prover binary.
 *
 * Background: the real prove() integration test (prove.test.ts) requires
 * the actual sui-prover binary plus a network clone of the asymptotic-code
 * Move dep into ~/.move; CI runners have neither, so that test self-skips
 * with SKIP_PROVER_NETWORK=1. That leaves the spawn-and-parse path (Move.toml
 * walk → cliArgs assembly → child_process.spawn → stdout/stderr parsing →
 * structured findings) without CI coverage above the unit level.
 *
 * This test fills the gap by pointing SUI_PROVER_BIN at a fake shell script
 * that emits canned stdout/stderr, then asserting the wrapper produces the
 * expected JSON shape for a happy-path run and for a failing-spec run. The
 * binary is never invoked for real; only the wrapper is under test.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { prove } from '../../src/prove.js';
import { clearBinaryCache } from '../../src/binary.js';

let scratchRoot: string;
let pkgPath: string;
let happyMock: string;
let failingMock: string;

const HAPPY_STDOUT = `🔄 amm::pool::deposit_spec_Check
✅ amm::pool::deposit_spec_Check
🔄 amm::pool::swap_spec_Check
✅ amm::pool::swap_spec_Check
2 specs verified
Verification successful
`;

const FAILING_STDERR = `🔄 amm::pool::withdraw_spec_Check
FAILED: amm::pool::withdraw_spec
  ensures may not hold: new_L.lte(new_A.mul(new_B))
  at /abs/amm/sources/pool.move:412:5
`;

function writeMockBinary(path: string, stdout: string, stderr: string, exitCode: number): void {
  // POSIX shell script that emits canned output regardless of args.
  // Quoting: single-quote the heredoc so $exitCode, etc. don't expand
  // inside the produced script.
  const body = [
    '#!/usr/bin/env bash',
    `cat <<'__SP_STDOUT__'`,
    stdout.trimEnd(),
    '__SP_STDOUT__',
    `cat >&2 <<'__SP_STDERR__'`,
    stderr.trimEnd(),
    '__SP_STDERR__',
    `exit ${exitCode}`,
    '',
  ].join('\n');
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

beforeAll(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), 'sui-prover-mcp-mock-'));

  // A minimal Move package so findPackageRoot + inspectPackage succeed.
  pkgPath = join(scratchRoot, 'pkg');
  mkdirSync(pkgPath);
  writeFileSync(
    join(pkgPath, 'Move.toml'),
    `[package]\nname = "mockpkg"\nedition = "2024"\n\n[addresses]\nmockpkg = "0x0"\n`
  );

  happyMock = join(scratchRoot, 'sui-prover-happy');
  writeMockBinary(happyMock, HAPPY_STDOUT, '', 0);

  failingMock = join(scratchRoot, 'sui-prover-failing');
  writeMockBinary(failingMock, '', FAILING_STDERR, 1);

  // Mock binaries need to look like a real `sui-prover --version` for the
  // capabilities probe. We just append a `--version`/`--help` short-circuit
  // to each mock so probeBinary's three sync calls all succeed.
  for (const path of [happyMock, failingMock]) {
    const wrapped = [
      '#!/usr/bin/env bash',
      'if [ "$1" = "--version" ]; then echo "sui-prover 0.0.0-mock"; exit 0; fi',
      'if [ "$1" = "--help" ]; then',
      '  echo "Usage: sui-prover [OPTIONS]"',
      '  echo "  --path --timeout --verbose --functions --modules"',
      '  exit 0',
      'fi',
      // For any other invocation, emit the canned proof output via the
      // body that writeMockBinary already laid down. We append the
      // original body below so the heredocs still fire.
      '',
    ].join('\n');
    const fs = require('fs');
    const tail = fs.readFileSync(path, 'utf8').replace(/^#!.*\n/, '');
    fs.writeFileSync(path, wrapped + tail);
    chmodSync(path, 0o755);
  }
});

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // The binary cache keys on the explicit path, but SUI_PROVER_BIN-driven
  // discovery passes through the same `''` key. Drop the cache so each
  // test sees a fresh probe against its own mock.
  clearBinaryCache();
});

describe('integration: prove() against a mock binary', () => {
  it('parses a happy-path run end to end', async () => {
    process.env['SUI_PROVER_BIN'] = happyMock;
    try {
      const result = await prove({ path: pkgPath, timeout_seconds: 60 });
      expect(result.binary.path).toBe(happyMock);
      expect(result.binary.version).toContain('0.0.0-mock');
      expect(result.package.name).toBe('mockpkg');
      expect(result.package.edition).toBe('2024');
      expect(result.invocation.exit_code).toBe(0);
      expect(result.invocation.args).toContain('--path');
      expect(result.invocation.args).toContain('--timeout');
      expect(result.summary.verified).toBeGreaterThanOrEqual(2);
      expect(result.summary.failed).toBe(0);
      expect(result.findings).toHaveLength(0);
      expect(result.raw_stdout).toContain('Verification successful');
    } finally {
      delete process.env['SUI_PROVER_BIN'];
    }
  });

  it('parses a failing-spec run and surfaces the structured finding', async () => {
    process.env['SUI_PROVER_BIN'] = failingMock;
    try {
      const result = await prove({
        path: pkgPath,
        target_function: 'amm::pool::withdraw',
        timeout_seconds: 60,
      });
      expect(result.invocation.exit_code).not.toBe(0);
      expect(result.invocation.args).toContain('--functions');
      expect(result.invocation.args).toContain('amm::pool::withdraw');
      expect(result.summary.failed).toBeGreaterThanOrEqual(1);
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      const ensuresFailed = result.findings.find((f) => f.kind === 'ensures_failed');
      expect(ensuresFailed).toBeDefined();
      expect(ensuresFailed?.spec).toBe('amm::pool::withdraw_spec');
      expect(ensuresFailed?.location?.file).toBe('/abs/amm/sources/pool.move');
      expect(ensuresFailed?.location?.line).toBe(412);
    } finally {
      delete process.env['SUI_PROVER_BIN'];
    }
  });

  it('forwards target_function as the --functions filter', async () => {
    process.env['SUI_PROVER_BIN'] = happyMock;
    try {
      const result = await prove({
        path: pkgPath,
        target_function: 'mockpkg::math::add',
      });
      expect(result.invocation.args).toContain('--functions');
      expect(result.invocation.args).toContain('mockpkg::math::add');
      expect(result.invocation.args).not.toContain('--modules');
    } finally {
      delete process.env['SUI_PROVER_BIN'];
    }
  });

  it('forwards target_module as the --modules filter (mutually exclusive)', async () => {
    process.env['SUI_PROVER_BIN'] = happyMock;
    try {
      const result = await prove({
        path: pkgPath,
        target_module: 'mockpkg::math',
      });
      expect(result.invocation.args).toContain('--modules');
      expect(result.invocation.args).toContain('mockpkg::math');
      expect(result.invocation.args).not.toContain('--functions');
    } finally {
      delete process.env['SUI_PROVER_BIN'];
    }
  });

  it('rejects mutually-exclusive target_function + target_module', async () => {
    process.env['SUI_PROVER_BIN'] = happyMock;
    try {
      await expect(
        prove({
          path: pkgPath,
          target_function: 'a::b::c',
          target_module: 'a::b',
        })
      ).rejects.toThrow(/mutually exclusive/);
    } finally {
      delete process.env['SUI_PROVER_BIN'];
    }
  });
});
