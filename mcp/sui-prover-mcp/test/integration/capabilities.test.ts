/**
 * Integration test: exercise the `capabilities()` tool end-to-end
 * against two real Move.toml files (clean + dirty) to confirm the
 * `setup_warning` finding shape promised in the PR test plan.
 *
 * No external dependencies -- writes the fixtures to mkdtempSync paths,
 * runs the function, cleans up. Always safe to run in CI.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { capabilities } from '../../src/capabilities.js';

let scratchRoot: string;
let cleanPkg: string;
let dirtyPkg: string;
let nonStandardEditionPkg: string;
let missingPkg: string;

beforeAll(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), 'sui-prover-mcp-caps-'));

  cleanPkg = join(scratchRoot, 'clean');
  mkdirSync(cleanPkg);
  writeFileSync(
    join(cleanPkg, 'Move.toml'),
    `[package]
name = "clean"
edition = "2024"

[addresses]
clean = "0x0"
`
  );

  dirtyPkg = join(scratchRoot, 'dirty');
  mkdirSync(dirtyPkg);
  writeFileSync(
    join(dirtyPkg, 'Move.toml'),
    `[package]
name = "dirty"
edition = "2024"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }
MoveStdlib = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/move-stdlib", rev = "framework/testnet" }
`
  );

  nonStandardEditionPkg = join(scratchRoot, 'edition');
  mkdirSync(nonStandardEditionPkg);
  writeFileSync(
    join(nonStandardEditionPkg, 'Move.toml'),
    `[package]
name = "edition_test"
edition = "legacy"
`
  );

  missingPkg = join(scratchRoot, 'missing');
  mkdirSync(missingPkg);
  // intentionally no Move.toml
});

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe('capabilities() setup_warnings (item 5 of PR test plan)', () => {
  it('emits NO setup_warning for a clean Move.toml', () => {
    const caps = capabilities({ move_toml_path: cleanPkg });
    expect(caps.setup_warnings).toEqual([]);
  });

  it('emits a setup_warning for each explicit framework dep', () => {
    const caps = capabilities({ move_toml_path: dirtyPkg });
    const kinds = caps.setup_warnings.map((w) => w.kind);
    expect(kinds.filter((k) => k === 'explicit_framework_dep')).toHaveLength(2);

    const deps = caps.setup_warnings
      .filter((w) => w.kind === 'explicit_framework_dep')
      .map((w) => (w.details as { dependency: string })?.dependency);
    expect(deps).toContain('Sui');
    expect(deps).toContain('MoveStdlib');

    // Every warning cites the offending Move.toml path so the user knows
    // where to edit.
    for (const w of caps.setup_warnings) {
      if (w.kind === 'explicit_framework_dep') {
        expect((w.details as { movetomlPath: string }).movetomlPath).toContain('Move.toml');
      }
    }
  });

  it('emits an edition_mismatch warning for non-2024 editions', () => {
    const caps = capabilities({ move_toml_path: nonStandardEditionPkg });
    const editionWarnings = caps.setup_warnings.filter((w) => w.kind === 'edition_mismatch');
    expect(editionWarnings).toHaveLength(1);
    expect(editionWarnings[0]!.message).toContain('legacy');
    expect(editionWarnings[0]!.message).toContain('2024');
  });

  it('accepts both "2024" and "2024.beta" without complaint', () => {
    const beta = join(scratchRoot, 'beta');
    mkdirSync(beta);
    writeFileSync(join(beta, 'Move.toml'), `[package]\nname = "beta"\nedition = "2024.beta"\n`);
    const caps = capabilities({ move_toml_path: beta });
    expect(caps.setup_warnings.filter((w) => w.kind === 'edition_mismatch')).toHaveLength(0);
  });

  it('emits a missing_movetoml warning when the path has no Move.toml', () => {
    const caps = capabilities({ move_toml_path: missingPkg });
    expect(caps.setup_warnings).toHaveLength(1);
    expect(caps.setup_warnings[0]!.kind).toBe('missing_movetoml');
  });

  it('reports binary presence honestly regardless of setup state', () => {
    const cleanCaps = capabilities({ move_toml_path: cleanPkg });
    const dirtyCaps = capabilities({ move_toml_path: dirtyPkg });
    // binary.found is environment-dependent; just assert it matches across calls
    expect(cleanCaps.binary.found).toBe(dirtyCaps.binary.found);
  });
});
