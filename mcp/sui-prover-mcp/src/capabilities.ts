/**
 * `prover_capabilities` tool implementation.
 *
 * Probes the local environment so the calling skill can decide whether
 * to proceed and what to warn about:
 *
 *   - sui-prover binary: presence, path, version, supported-flag set
 *   - cloud config presence (~/.asymptotic/sui_prover.toml)
 *   - Sui toolchain version (best-effort, for the 1.45+ implicit-deps gate)
 *   - setup_warnings for an optional Move.toml -- e.g. explicit Sui dep
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { probeBinary } from './binary.js';
import { inspectPackage } from './move-toml.js';

export interface CapabilitiesArgs {
  move_toml_path?: string;          // optional: a package to probe for setup warnings
}

export interface Capabilities {
  binary: {
    found: boolean;
    path: string | null;
    version: string | null;
    supported_flags: string[];
  };
  cloud: {
    available: boolean;             // ~/.asymptotic/sui_prover.toml exists
    config_path: string;
  };
  sui_toolchain: {
    found: boolean;
    version: string | null;
  };
  setup_warnings: SetupWarning[];   // only populated when move_toml_path is given
}

export interface SetupWarning {
  kind: 'explicit_framework_dep' | 'edition_mismatch' | 'missing_movetoml';
  message: string;
  details?: Record<string, unknown>;
}

const SUI_VERSION_PROBE_TIMEOUT_MS = 5_000;

export function capabilities(args: CapabilitiesArgs): Capabilities {
  const binary = probeBinary();
  const configPath = join(homedir(), '.asymptotic', 'sui_prover.toml');
  const setupWarnings: SetupWarning[] = [];

  if (args.move_toml_path) {
    try {
      const pkg = inspectPackage(args.move_toml_path);
      for (const dep of pkg.explicitFrameworkDeps) {
        setupWarnings.push({
          kind: 'explicit_framework_dep',
          message: `Move.toml has an explicit \`${dep}\` dependency. Sui 1.45+ implicit-dep injection is disabled for this package. Remove the explicit \`${dep} = { ... }\` entry from [dependencies] and retry.`,
          details: { dependency: dep, movetomlPath: pkg.movetomlPath },
        });
      }
      // Edition probe: the prover examples use 2024.beta; the user's
      // preferred form is 2024. Anything else is suspicious for a
      // prover-targeted package.
      if (pkg.edition && !['2024', '2024.beta'].includes(pkg.edition)) {
        setupWarnings.push({
          kind: 'edition_mismatch',
          message: `Move.toml edition is "${pkg.edition}"; the prover targets Move 2024 (accepts "2024" or "2024.beta"). Verify intent.`,
          details: { edition: pkg.edition, movetomlPath: pkg.movetomlPath },
        });
      }
    } catch (err) {
      setupWarnings.push({
        kind: 'missing_movetoml',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    binary: {
      found: binary.found,
      path: binary.path,
      version: binary.version,
      supported_flags: binary.supportedFlags,
    },
    cloud: {
      available: existsSync(configPath),
      config_path: configPath,
    },
    sui_toolchain: probeSuiToolchain(),
    setup_warnings: setupWarnings,
  };
}

function probeSuiToolchain(): { found: boolean; version: string | null } {
  try {
    const stdout = execFileSync('sui', ['--version'], {
      encoding: 'utf8',
      timeout: SUI_VERSION_PROBE_TIMEOUT_MS,
    });
    const match = stdout.trim().match(/(\d+\.\d+\.\d+)/);
    return { found: true, version: match ? match[1]! : stdout.trim() };
  } catch {
    return { found: false, version: null };
  }
}
