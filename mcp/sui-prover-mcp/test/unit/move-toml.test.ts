import { describe, it, expect } from 'vitest';
import { detectExplicitFrameworkDeps } from '../../src/move-toml.js';

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
