import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectExplicitFrameworkDeps, inspectPackage } from '../../src/move-toml.js';

describe('detectExplicitFrameworkDeps', () => {
  it('returns no deps for the prover-recommended minimal Move.toml', () => {
    const toml = `[package]
name = "AMM"
edition = "2024"

[addresses]
amm = "0x0"
`;
    expect(detectExplicitFrameworkDeps(toml)).toEqual([]);
  });

  it('detects an explicit Sui dependency', () => {
    const toml = `[package]
name = "foo"
edition = "2024"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }
`;
    expect(detectExplicitFrameworkDeps(toml)).toContain('Sui');
  });

  it('detects multiple framework deps', () => {
    const toml = `[package]
name = "foo"

[dependencies]
Sui = "..."
MoveStdlib = "..."
DeepBook = "..."
`;
    const deps = detectExplicitFrameworkDeps(toml);
    expect(deps).toContain('Sui');
    expect(deps).toContain('MoveStdlib');
    expect(deps).toContain('DeepBook');
  });

  it('ignores deps with framework-like names in other sections', () => {
    const toml = `[package]
name = "Sui"

[addresses]
Sui = "0x2"
`;
    expect(detectExplicitFrameworkDeps(toml)).toEqual([]);
  });
});

describe('inspectPackage (regression: R2-001 / R1-004 — \\Z literal-Z bug)', () => {
  it('extracts name + edition when the package values contain `Z`', () => {
    // The earlier `extractField` regex used `(?=^\[|\Z)` -- a Python anchor
    // that JS interprets as literal `Z`, so any `[package]` value
    // containing Z (e.g. "ZooPackage") truncated the scope and returned
    // null for every field.
    const dir = mkdtempSync(join(tmpdir(), 'sui-prover-mcp-tomlz-'));
    try {
      writeFileSync(
        join(dir, 'Move.toml'),
        `[package]
name = "ZooPackage"
edition = "2024"

[addresses]
zoo = "0x0"
`
      );
      const pkg = inspectPackage(dir);
      expect(pkg.name).toBe('ZooPackage');
      expect(pkg.edition).toBe('2024');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still terminates the [package] scope at the next top-level section header', () => {
    // Sibling check: ensure the fixed regex doesn't accidentally let
    // [dependencies] fields leak into the name/edition extraction.
    const dir = mkdtempSync(join(tmpdir(), 'sui-prover-mcp-tomlz2-'));
    try {
      writeFileSync(
        join(dir, 'Move.toml'),
        `[package]
name = "real_pkg"
edition = "2024"

[dependencies]
name = "decoy"
edition = "decoy"
`
      );
      const pkg = inspectPackage(dir);
      expect(pkg.name).toBe('real_pkg');
      expect(pkg.edition).toBe('2024');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Keep tree-shaking from dropping the import.
void mkdirSync;
