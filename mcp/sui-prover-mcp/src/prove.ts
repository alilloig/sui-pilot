/**
 * `prove_package` tool implementation.
 *
 * Spawns the sui-prover binary against a package, captures stdout+stderr,
 * measures duration, and routes the output through the parse-output module
 * to produce structured findings. The function is intentionally pure
 * w.r.t. the filesystem -- it does NOT auto-fix Move.toml issues. Setup
 * warnings (explicit Sui/MoveStdlib deps) are surfaced as findings of
 * kind="setup_warning" so the calling skill can show them and let the
 * user decide.
 */

import { spawn } from 'child_process';
import { info, warn } from './logger.js';
import { requireBinary } from './binary.js';
import { findPackageRoot, inspectPackage } from './move-toml.js';
import { parseProverOutput, Finding } from './parse-output.js';
import { SuiProverError, INVALID_ARGUMENT, PROVE_SPAWN_FAILED } from './errors.js';

export interface ProveArgs {
  path: string;                       // file or directory; auto-walks to Move.toml
  target_function?: string;           // pkg::mod::fn -- forwarded as `--functions`
  target_module?: string;             // pkg::mod    -- forwarded as `--modules`
  timeout_seconds?: number;           // forwarded as `--timeout`
  verbose?: boolean;
  extra_args?: string[];              // escape hatch; filtered against supportedFlags
}

export interface ProveResult {
  binary: { version: string | null; path: string };
  package: { path: string; name: string | null; edition: string | null };
  invocation: { args: string[]; duration_ms: number; exit_code: number | null; signal: string | null };
  summary: { verified: number; failed: number; skipped: number; timeouts: number };
  findings: Finding[];
  raw_stdout: string;
  raw_stderr: string;
}

const DEFAULT_TIMEOUT_SECONDS = 60;

/**
 * Run sui-prover and return a structured result. Throws SuiProverError
 * subclasses only when the wrapper cannot even invoke the binary
 * (missing binary, missing Move.toml, invalid args). A prover failure
 * (non-zero exit) is a successful tool call returning findings with
 * severity="error" -- the caller decides what to do.
 */
export async function prove(args: ProveArgs): Promise<ProveResult> {
  if (!args.path || typeof args.path !== 'string') {
    throw new SuiProverError('path is required and must be a string', INVALID_ARGUMENT);
  }
  if (args.target_function && args.target_module) {
    throw new SuiProverError(
      'target_function and target_module are mutually exclusive',
      INVALID_ARGUMENT
    );
  }

  const binary = requireBinary();
  const pkgRoot = findPackageRoot(args.path);
  const pkg = inspectPackage(pkgRoot);

  // Compose CLI args. `--path` is always passed even though the binary
  // defaults to cwd -- explicit > implicit when invoked via MCP.
  const cliArgs: string[] = ['--path', pkgRoot];

  const timeoutSeconds = args.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS;
  cliArgs.push('--timeout', String(timeoutSeconds));

  if (args.target_function) cliArgs.push('--functions', args.target_function);
  if (args.target_module) cliArgs.push('--modules', args.target_module);
  if (args.verbose) cliArgs.push('--verbose');

  // Filter user-supplied `extra_args` against the binary's actual flag set
  // (parsed from `--help`). Core flags above (`--path`, `--timeout`,
  // `--functions`, `--modules`, `--verbose`) are NOT filtered -- they're
  // load-bearing for the wrapper's contract, so if a future binary release
  // removes one we want a hard error, not silent degradation. The gate
  // applies only to the escape-hatch path that users opt into.
  if (args.extra_args && args.extra_args.length > 0) {
    const supported = new Set(binary.supportedFlags);
    for (const ea of args.extra_args) {
      const flagName = ea.split('=')[0]!;
      if (!supported.has(flagName)) {
        warn('Refusing to forward unsupported extra_arg to sui-prover', {
          arg: ea,
          supportedFlagCount: binary.supportedFlags.length,
        });
        continue;
      }
      cliArgs.push(ea);
    }
  }

  info('Invoking sui-prover', { binary: binary.path, cliArgs });
  const startedAt = Date.now();
  // No artificial wall-clock kill: `--timeout` is the binary's per-spec budget,
  // and a single `prove_package` call can verify N specs (whole-package or
  // `target_module`), so an N×timeout ceiling is the only honest upper bound
  // -- and we don't know N here. Trust the binary's self-management; the user
  // can always SIGINT the parent process.
  const { stdout, stderr, exitCode, signal } = await spawnProver(binary.path, cliArgs);
  const duration = Date.now() - startedAt;

  const parsed = parseProverOutput(stdout, stderr, exitCode ?? -1);

  // Synthesize setup-warning findings BEFORE the parsed findings so they
  // sort to the top of the list visually.
  const findings: Finding[] = [];
  for (const dep of pkg.explicitFrameworkDeps) {
    findings.push({
      kind: 'setup_warning',
      severity: 'warning',
      message: `Move.toml has an explicit \`${dep}\` dependency. Sui 1.45+ implicit-dep injection is disabled for this package, which the prover needs. Remove the explicit \`${dep} = { ... }\` entry from [dependencies] in ${pkg.movetomlPath} and retry.`,
      location: { file: pkg.movetomlPath, line: 0, col: 0 },
      spec: null,
      function_under_test: null,
      counterexample: null,
    });
  }
  findings.push(...parsed.findings);

  return {
    binary: { version: binary.version, path: binary.path },
    package: { path: pkg.path, name: pkg.name, edition: pkg.edition },
    invocation: { args: cliArgs, duration_ms: duration, exit_code: exitCode, signal },
    summary: parsed.summary,
    findings,
    raw_stdout: stdout,
    raw_stderr: stderr,
  };
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
}

/**
 * Spawn the prover binary with an explicit argv list (no shell). Captures
 * stdout/stderr into strings and resolves with the full result when the
 * process exits.
 *
 * No wrapper-level kill: `--timeout` is the binary's per-spec budget. A
 * single call may verify N specs, so the wrapper cannot derive a correct
 * wall-clock ceiling without knowing N. Trust the binary's self-management.
 */
function spawnProver(binaryPath: string, args: string[]): Promise<SpawnResult> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    const child = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      rejectSpawn(new SuiProverError(`Failed to spawn sui-prover: ${err.message}`, PROVE_SPAWN_FAILED));
    });

    child.on('close', (code, signal) => {
      resolveSpawn({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: code, signal });
    });
  });
}
