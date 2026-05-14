/**
 * Parse sui-prover stdout/stderr into structured findings.
 *
 * The 1.5.x binary emits free-form text. This parser covers two output
 * shapes:
 *
 *   (a) Per-spec emoji lines (1.5.3+):
 *         🔄 <pkg>::<mod>::<spec_name>            // in-progress, ignored
 *         ✅ <pkg>::<mod>::<spec_name>            // verified
 *         ⏭️ <pkg>::<mod>::<spec_name> at <loc>   // skipped (#[spec(skip)])
 *         ❌ <pkg>::<mod>::<spec_name> at <loc>   // failed
 *       followed by "Verification successful" on a fully-green run.
 *
 *   (b) Legacy free-form output (older releases, kept for compatibility):
 *         "Verifying foo_spec" / "3 specs verified" / "FAILED: bar_spec"
 *
 * Plus a dedicated pre-spec failure pass that recognizes the common
 * compile-time blockers (dep fetch, address conflict, unresolved module,
 * function-not-found, target-body-no-call, "nothing to verify") and
 * returns them as structured kinds rather than as the catch-all
 * kind="unknown".
 */

/** Strip ANSI escape sequences (CSI: ESC[…<final-byte>). */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '');
}

export type FindingKind =
  // Per-spec verdicts
  | 'verified'
  | 'failed'
  | 'skipped'
  | 'timeout'
  // Pre-spec compile-time failures (structured)
  | 'dep_address_conflict'
  | 'unresolved_named_address'
  | 'unresolved_module'
  | 'dep_fetch_failure'
  | 'function_not_found'
  | 'spec_target_body_no_call'
  | 'no_specs_to_prove'
  // Legacy / generic
  | 'ensures_failed'
  | 'asserts_failed'
  | 'abort_unspecified'
  | 'no_spec'
  | 'parse_error'
  | 'compile_error'
  | 'setup_warning'
  | 'unknown';

export type FindingSeverity = 'error' | 'warning' | 'info';

export type SummaryOverall =
  | 'verified_all'
  | 'failed_some'
  | 'no_specs'
  | 'compile_failure'
  | 'timeout'
  | 'error';

export interface FindingLocation {
  file: string;
  line: number;
  col: number;
}

export interface Finding {
  kind: FindingKind;
  severity: FindingSeverity;
  message: string;
  location: FindingLocation | null;
  spec: string | null;
  function_under_test: string | null;
  counterexample: { raw: string; bindings: Record<string, string> } | null;
}

export interface ParsedOutput {
  summary: {
    overall: SummaryOverall;
    verified: number;
    failed: number;
    skipped: number;
    timeouts: number;
  };
  findings: Finding[];
}

/**
 * Parse the prover's textual output. Public entry point. Strips ANSI,
 * runs the emoji pass, runs the legacy pass, runs pre-spec failure
 * detection, then computes an overall status string.
 */
export function parseProverOutput(stdout: string, stderr: string, exitCode: number): ParsedOutput {
  const cleanStdout = stripAnsi(stdout);
  const cleanStderr = stripAnsi(stderr);

  const emoji = parseEmojiLines(cleanStdout, cleanStderr);
  const legacy = parseLegacyLines(cleanStdout, cleanStderr);
  const preSpec = detectPreSpecFailure(cleanStdout, cleanStderr);

  let findings: Finding[] = [...emoji.findings, ...legacy.findings];
  // Pre-spec failures sort to the front and suppress generic compile_error /
  // unknown findings that describe the same root cause.
  if (preSpec) {
    findings = [preSpec, ...findings.filter((f) => f.kind !== 'compile_error' && f.kind !== 'unknown')];
  }

  const verified = emoji.verified + legacy.verified;
  const failed = emoji.failed + legacy.failed;
  const skipped = emoji.skipped + legacy.skipped;
  const timeouts = emoji.timeouts + legacy.timeouts;

  // Catch-all: prover failed but we have no findings whatsoever.
  if (exitCode !== 0 && findings.length === 0) {
    findings.push({
      kind: 'unknown',
      severity: 'error',
      message: `sui-prover exited with code ${exitCode} but produced no parseable findings`,
      location: null,
      spec: null,
      function_under_test: null,
      counterexample: null,
    });
  }

  const overall = computeOverall({ verified, failed, skipped, timeouts }, findings, exitCode);

  return {
    summary: { overall, verified, failed, skipped, timeouts },
    findings,
  };
}

// ─── Pre-spec failure detection ─────────────────────────────────────────────

/**
 * Look for compile-time error patterns that fire BEFORE any spec gets
 * evaluated. These are the most common reasons a /specify run hits zero
 * verification subchecks — surfacing them as structured kinds saves the
 * calling skill from grepping `raw_stdout` itself.
 *
 * Returns the most informative single finding, or null if none match.
 * Patterns ordered most-specific first; first match wins.
 */
function detectPreSpecFailure(stdout: string, stderr: string): Finding | null {
  const combined = `${stdout}\n${stderr}`;

  // dep_address_conflict — agent ran with two address assignments for one named address
  const addrConflict = combined.match(/Conflicting assignments for address '([^']+)':\s*'([^']+)'\s*and\s*'([^']+)'/);
  if (addrConflict) {
    return makeFinding(
      'dep_address_conflict',
      `Conflicting address for '${addrConflict[1]}': ${addrConflict[2]} vs ${addrConflict[3]}`
    );
  }

  // unresolved_named_address — typically a missing [addresses] entry
  const unresolved = combined.match(/Unable to resolve named address '([^']+)'/);
  if (unresolved) {
    return makeFinding('unresolved_named_address', `Unable to resolve named address '${unresolved[1]}'`);
  }

  // unresolved_module — generic Move resolution failure
  const unboundMod = combined.match(/Unbound module '([^']+)'/);
  if (unboundMod) {
    return makeFinding('unresolved_module', `Unbound module '${unboundMod[1]}'`);
  }

  // dep_fetch_failure — git clone failure (private repo, network)
  if (/Repository not found|fatal: Could not read from remote repository/.test(combined)) {
    const url = combined.match(/git@[^\s]+\.git|https:\/\/[^\s]+\.git/);
    return makeFinding(
      'dep_fetch_failure',
      url ? `Repository not reachable: ${url[0]}` : 'A git dependency could not be fetched'
    );
  }

  // function_not_found — invalid --functions target
  const noFn = combined.match(/Function `([^`]+)` does not exist/);
  if (noFn) {
    return makeFinding('function_not_found', `Function '${noFn[1]}' does not exist in the package`, {
      function_under_test: noFn[1] ?? null,
    });
  }

  // spec_target_body_no_call — `#[spec(target = X)]` without calling X in the body
  const targetNoCall = combined.match(/Spec function `([^`]+)` should call target function `([^`]+)`/);
  if (targetNoCall) {
    return makeFinding(
      'spec_target_body_no_call',
      `Spec '${targetNoCall[1]}' must call its target '${targetNoCall[2]}', or use #[spec(skip, target = ${targetNoCall[2]})]`,
      { spec: targetNoCall[1] ?? null, function_under_test: targetNoCall[2] ?? null }
    );
  }

  // no_specs_to_prove — prover succeeded but found nothing marked
  if (/No specifications are marked for verification/.test(combined)) {
    return makeFinding('no_specs_to_prove', 'No specifications are marked for verification', { severity: 'info' });
  }

  return null;
}

function makeFinding(
  kind: FindingKind,
  message: string,
  overrides: Partial<Finding> = {}
): Finding {
  return {
    kind,
    severity: 'error',
    message,
    location: null,
    spec: null,
    function_under_test: null,
    counterexample: null,
    ...overrides,
  };
}

// ─── Emoji pass (sui-prover 1.5.3+) ─────────────────────────────────────────

interface SubResult {
  verified: number;
  failed: number;
  skipped: number;
  timeouts: number;
  findings: Finding[];
}

function parseEmojiLines(stdout: string, stderr: string): SubResult {
  const lines = `${stdout}\n${stderr}`.split('\n');
  const out: SubResult = { verified: 0, failed: 0, skipped: 0, timeouts: 0, findings: [] };

  // The skip arrow `⏭` may appear with or without its U+FE0F variation
  // selector depending on whether the terminal applied emoji presentation;
  // the trailing `️?` covers both forms. `✅` (U+2705) and `❌`
  // (U+274C) are single code points and need no variant.
  const VERIFIED = /✅\s+([\w:]+)/;
  const FAILED = /❌\s+([\w:]+)(?:\s+at\s+(\S+))?/;
  const SKIPPED = /⏭️?\s+([\w:]+)(?:\s+at\s+(\S+))?/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let m: RegExpMatchArray | null;

    // ✅ verified
    m = trimmed.match(VERIFIED);
    if (m) {
      out.verified += 1;
      // Don't emit a finding per verified spec — keeps the response compact
      // on green runs. The count in summary.verified is the signal.
      continue;
    }

    // ❌ failed
    m = trimmed.match(FAILED);
    if (m) {
      out.failed += 1;
      const specName = m[1]!;
      out.findings.push({
        kind: 'failed',
        severity: 'error',
        message: trimmed,
        location: m[2] ? parseLocation(m[2]) : null,
        spec: specName.includes('::') ? specName : null,
        function_under_test: deriveFunctionUnderTest(specName),
        counterexample: null,
      });
      continue;
    }

    // ⏭️ skipped (info: tells the caller the spec exists but isn't proven)
    m = trimmed.match(SKIPPED);
    if (m) {
      out.skipped += 1;
      const specName = m[1]!;
      out.findings.push({
        kind: 'skipped',
        severity: 'info',
        message: trimmed,
        location: m[2] ? parseLocation(m[2]) : null,
        spec: specName.includes('::') ? specName : null,
        function_under_test: deriveFunctionUnderTest(specName),
        counterexample: null,
      });
    }
  }

  return out;
}

/** Parse a "path.move:line[:col]" location pointer. */
function parseLocation(raw: string): FindingLocation | null {
  const m = raw.match(/^(.+?\.move):(\d+)(?::(\d+))?$/);
  if (!m) return null;
  return { file: m[1]!, line: parseInt(m[2]!, 10), col: m[3] ? parseInt(m[3], 10) : 0 };
}

// ─── Legacy pass (free-form 1.4.x and earlier) ──────────────────────────────

/**
 * Original line-loop parser for older prover output forms. Kept so we
 * don't lose support if the binary regresses or is pinned. New emoji
 * format takes precedence — this pass is additive.
 */
function parseLegacyLines(stdout: string, stderr: string): SubResult {
  const lines = `${stdout}\n${stderr}`.split('\n');
  const out: SubResult = { verified: 0, failed: 0, skipped: 0, timeouts: 0, findings: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Summary counters: "3 specs verified" / "1 skipped"
    const sumMatch = line.match(/(\d+)\s+specs?\s+verified/i);
    if (sumMatch) out.verified += parseInt(sumMatch[1]!, 10);

    if (/\bskipped\b/i.test(line)) {
      const sm = line.match(/(\d+)\s+(?:specs?\s+)?skipped/i);
      if (sm) out.skipped += parseInt(sm[1]!, 10);
    }

    // "FAILED: spec_name" / "verification failed: spec_name"
    const failedSpec = line.match(/(?:FAILED|verification failed)\s*[:\-]?\s*([\w:]+)/i);
    if (failedSpec) {
      const specName = failedSpec[1]!;
      const surroundingContext = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 10)).join('\n');
      out.findings.push({
        kind: classifyFailureKind(surroundingContext),
        severity: 'error',
        message: line.trim(),
        location: findLocationNear(lines, i),
        spec: specName.includes('::') ? specName : null,
        function_under_test: deriveFunctionUnderTest(specName),
        counterexample: extractCounterexample(lines, i),
      });
      out.failed += 1;
      continue;
    }

    // Timeout banner
    if (/timed out|timeout exceeded/i.test(line)) {
      out.timeouts += 1;
      out.findings.push({
        kind: 'timeout',
        severity: 'error',
        message: line.trim(),
        location: findLocationNear(lines, i),
        spec: extractSpecFromLine(line),
        function_under_test: null,
        counterexample: null,
      });
      continue;
    }

    // Generic "error: …" lines upstream of verification. Pre-spec detection
    // upgrades these to structured kinds when they match known patterns;
    // this catches anything left over.
    if (/^error\b/i.test(line.trim())) {
      out.findings.push({
        kind: line.toLowerCase().includes('parse') ? 'parse_error' : 'compile_error',
        severity: 'error',
        message: line.trim(),
        location: findLocationNear(lines, i),
        spec: null,
        function_under_test: null,
        counterexample: null,
      });
    }

    // Abort-unspecified hint
    if (/may abort|abort condition (?:not|un)specified/i.test(line)) {
      out.findings.push({
        kind: 'abort_unspecified',
        severity: 'warning',
        message: line.trim(),
        location: findLocationNear(lines, i),
        spec: null,
        function_under_test: extractFqnFromLine(line),
        counterexample: null,
      });
    }
  }

  return out;
}

// ─── overall status computation ─────────────────────────────────────────────

function computeOverall(
  counts: { verified: number; failed: number; skipped: number; timeouts: number },
  findings: Finding[],
  exitCode: number
): SummaryOverall {
  if (counts.failed > 0) return 'failed_some';
  if (counts.timeouts > 0) return 'timeout';

  const COMPILE_FAILURE_KINDS = new Set<FindingKind>([
    'dep_address_conflict',
    'unresolved_named_address',
    'unresolved_module',
    'dep_fetch_failure',
    'function_not_found',
    'spec_target_body_no_call',
    'compile_error',
    'parse_error',
  ]);
  if (findings.some((f) => COMPILE_FAILURE_KINDS.has(f.kind))) return 'compile_failure';

  if (findings.some((f) => f.kind === 'no_specs_to_prove')) return 'no_specs';

  if (counts.verified > 0 && exitCode === 0) return 'verified_all';
  if (exitCode !== 0) return 'error';

  // exitCode === 0 and no specs counted — treat as no_specs (the prover
  // returns 0 when there's literally nothing to verify and didn't print
  // the recognized banner).
  return 'no_specs';
}

// ─── shared helpers ─────────────────────────────────────────────────────────

function classifyFailureKind(context: string): FindingKind {
  if (/ensures (?:may not hold|failed)/i.test(context)) return 'ensures_failed';
  if (/asserts (?:may not hold|failed)/i.test(context)) return 'asserts_failed';
  if (/no spec for|missing spec/i.test(context)) return 'no_spec';
  if (/timeout|timed out/i.test(context)) return 'timeout';
  return 'unknown';
}

function findLocationNear(lines: string[], i: number): FindingLocation | null {
  for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 5); j++) {
    const line = lines[j]!;
    const m = line.match(/([^\s:]+\.move):(\d+)(?::(\d+))?/);
    if (m) {
      return { file: m[1]!, line: parseInt(m[2]!, 10), col: m[3] ? parseInt(m[3], 10) : 0 };
    }
  }
  return null;
}

function deriveFunctionUnderTest(specName: string): string | null {
  const m = specName.match(/^(.+)_spec$/);
  return m ? m[1]! : null;
}

function extractSpecFromLine(line: string): string | null {
  const m = line.match(/(\b[\w]+_spec\b)/);
  return m ? m[1]! : null;
}

function extractFqnFromLine(line: string): string | null {
  const m = line.match(/\b([a-zA-Z_][\w]*(?:::[a-zA-Z_][\w]*)+)\b/);
  return m ? m[1]! : null;
}

function extractCounterexample(
  lines: string[],
  startIdx: number
): { raw: string; bindings: Record<string, string> } | null {
  const cxStart = lines.findIndex(
    (l, idx) => idx >= startIdx && idx <= startIdx + 20 && /counterexample/i.test(l)
  );
  if (cxStart === -1) return null;

  const raw: string[] = [];
  const bindings: Record<string, string> = {};
  for (let j = cxStart + 1; j < lines.length && j < cxStart + 30; j++) {
    const line = lines[j]!;
    if (/^\s*$/.test(line) || /^Spec\b|^Verifying\b|^FAILED\b/i.test(line)) break;
    raw.push(line);
    const bind = line.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/);
    if (bind) bindings[bind[1]!] = bind[2]!;
  }
  if (raw.length === 0) return null;
  return { raw: raw.join('\n'), bindings };
}
