/**
 * sui-prover binary discovery and metadata. The Asymptotic project uses
 * Fibonacci-style versioning (1.5.3 -> 1.8.5 -> 1.13.8 -> ...) and explicitly
 * promises change between rungs, so we never assume a fixed flag set --
 * `--help` is parsed at startup to derive the supported-flag intersection.
 *
 * Mirrors mcp/move-lsp-mcp/src/binary-discovery.ts: same `execFileSync` style
 * (no shell, explicit argv array) for probe calls. Long-running prove
 * invocations use `spawn` separately in prove.ts.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { BinaryNotFoundError } from './errors.js';

export interface BinaryInfo {
  found: boolean;
  path: string | null;
  version: string | null;
  helpText: string | null;
  supportedFlags: string[];
}

const PROBE_TIMEOUT_MS = 5_000;

export function discoverBinary(explicitPath?: string): string | null {
  if (explicitPath && existsSync(explicitPath)) return explicitPath;

  try {
    const stdout = execFileSync('which', ['sui-prover'], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
    });
    const path = stdout.trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

export function getBinaryVersion(binaryPath: string): string | null {
  try {
    const stdout = execFileSync(binaryPath, ['--version'], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
    });
    const match = stdout.trim().match(/(\d+\.\d+\.\d+)/);
    return match ? match[1]! : stdout.trim() || null;
  } catch {
    return null;
  }
}

export function getHelpInfo(binaryPath: string): { helpText: string; flags: string[] } {
  const helpText = execFileSync(binaryPath, ['--help'], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
  });
  return { helpText, flags: parseSupportedFlags(helpText) };
}

export function parseSupportedFlags(helpText: string): string[] {
  // Long flags only -- short flags vary more across releases.
  const flags = new Set<string>();
  for (const match of helpText.matchAll(/--([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
    flags.add(`--${match[1]}`);
  }
  return [...flags].sort();
}

export function probeBinary(explicitPath?: string): BinaryInfo {
  const path = discoverBinary(explicitPath);
  if (!path) {
    return { found: false, path: null, version: null, helpText: null, supportedFlags: [] };
  }

  const version = getBinaryVersion(path);
  let helpText: string | null = null;
  let supportedFlags: string[] = [];
  try {
    const help = getHelpInfo(path);
    helpText = help.helpText;
    supportedFlags = help.flags;
  } catch {
    // Help-probe failure is non-fatal -- return what we have.
  }
  return { found: true, path, version, helpText, supportedFlags };
}

export function requireBinary(explicitPath?: string): BinaryInfo & { path: string } {
  const info = probeBinary(explicitPath);
  if (!info.found || !info.path) throw new BinaryNotFoundError(explicitPath);
  return info as BinaryInfo & { path: string };
}
