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

  // SUI_PROVER_BIN lets tests (and operators with non-PATH installs)
  // point at a specific binary without changing the call site. Tests use
  // this to swap in a mock shell script; operators with multiple installs
  // pin a version.
  const envPath = process.env['SUI_PROVER_BIN'];
  if (envPath && existsSync(envPath)) return envPath;

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
    // Capture core MAJOR.MINOR.PATCH plus any pre-release suffix
    // (e.g. "0.0.0-mock", "1.6.0-rc1") so version drift remains visible
    // to the operator instead of being silently truncated.
    const match = stdout.trim().match(/(\d+\.\d+\.\d+(?:-[\w.-]+)?)/);
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

// Process-lifetime cache. /specify runs `prove_package` per externally-
// reachable function on the same package, so without this we'd re-spawn
// `which` + `--version` + `--help` (three sync child processes) on every
// tool call. The probe is cached against the explicit-path argument so
// tests using different mock-binary paths don't collide.
const probeCache = new Map<string, BinaryInfo>();

/**
 * Clear the binary-probe cache. Tests use this between scenarios; not
 * needed in production unless the operator swaps the binary mid-session.
 */
export function clearBinaryCache(): void {
  probeCache.clear();
}

export function probeBinary(explicitPath?: string): BinaryInfo {
  const key = explicitPath ?? '';
  const cached = probeCache.get(key);
  if (cached) return cached;

  const path = discoverBinary(explicitPath);
  if (!path) {
    const miss: BinaryInfo = {
      found: false, path: null, version: null, helpText: null, supportedFlags: [],
    };
    probeCache.set(key, miss);
    return miss;
  }

  const version = getBinaryVersion(path);
  let helpText: string | null = null;
  let supportedFlags: string[] = [];
  try {
    const help = getHelpInfo(path);
    helpText = help.helpText;
    supportedFlags = help.flags;
  } catch {
    // Help-probe failure is non-fatal -- cache what we have.
  }
  const info: BinaryInfo = { found: true, path, version, helpText, supportedFlags };
  probeCache.set(key, info);
  return info;
}

export function requireBinary(explicitPath?: string): BinaryInfo & { path: string } {
  const info = probeBinary(explicitPath);
  if (!info.found || !info.path) throw new BinaryNotFoundError(explicitPath);
  return info as BinaryInfo & { path: string };
}
