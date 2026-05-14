import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectExplicitFrameworkDeps, inspectPackage, parseGitDependencies } from '../../src/move-toml.js';

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

describe('parseGitDependencies', () => {
  it('extracts the block form [dependencies.NAME]', () => {
    const toml = `[package]
name = "amm-math"
edition = "2024"

[dependencies.utilities]
git = "git@github.com:AftermathFinance/utilities.git"
subdir = "packages/utils"
rev = "main"
`;
    const deps = parseGitDependencies(toml);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toEqual({
      name: 'utilities',
      url: 'git@github.com:AftermathFinance/utilities.git',
      rev: 'main',
      subdir: 'packages/utils',
    });
  });

  it('extracts the inline form NAME = { git = "..." }', () => {
    const toml = `[package]
name = "foo"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }
`;
    const deps = parseGitDependencies(toml);
    expect(deps).toHaveLength(1);
    expect(deps[0]?.name).toBe('Sui');
    expect(deps[0]?.url).toBe('https://github.com/MystenLabs/sui.git');
    expect(deps[0]?.rev).toBe('framework/testnet');
    expect(deps[0]?.subdir).toBe('crates/sui-framework/packages/sui-framework');
  });

  it('extracts multiple block-form deps without dedup duplicates', () => {
    const toml = `[package]
name = "amm"

[dependencies.ProtocolFeeVault]
git = "git@github.com:AftermathFinance/amm-protocol-fee-vault.git"
subdir = "protocol-fee-vault"
rev = "development"

[dependencies.AftermathFaucet]
git = "git@github.com:AftermathFinance/test-coins.git"
rev = "main"
`;
    const deps = parseGitDependencies(toml);
    expect(deps).toHaveLength(2);
    expect(deps.map((d) => d.name).sort()).toEqual(['AftermathFaucet', 'ProtocolFeeVault']);
  });

  it('returns [] for a TOML with no git deps', () => {
    expect(parseGitDependencies('[package]\nname = "x"\n')).toEqual([]);
    expect(parseGitDependencies('[package]\nname = "x"\n\n[addresses]\nx = "0x0"\n')).toEqual([]);
  });
});

// Keep tree-shaking from dropping the import.
void mkdirSync;
