/**
 * Parse sui-prover stdout/stderr into structured findings.
 *
 * The 1.5.3 binary emits free-form text with no `--output=json` flag.
 * This parser captures the load-bearing taxonomy from the plan
 * (drifting-rolling-pike.md §5.2):
 *
 *   ensures_failed, asserts_failed, timeout, abort_unspecified,
 *   no_spec, parse_error, compile_error, setup_warning
 *
 * The parser is intentionally conservative: when in doubt we leave a
 * finding with kind="unknown" so downstream skills always have BOTH
 * structured findings AND raw_stdout/raw_stderr to fall back on. The
 * raw output is the escape hatch when binary releases drift.
 */

export type FindingKind =
  | 'ensures_failed'
  | 'asserts_failed'
  | 'timeout'
  | 'abort_unspecified'
  | 'no_spec'
  | 'parse_error'
  | 'compile_error'
  | 'setup_warning'
  | 'unknown';

export type FindingSeverity = 'error' | 'warning' | 'info';

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
  spec: string | null;                 // e.g. "amm::pool::withdraw_spec"
  function_under_test: string | null;  // e.g. "amm::pool::withdraw"
  counterexample: { raw: string; bindings: Record<string, string> } | null;
}

export interface ParsedOutput {
  summary: {
    verified: number;
    failed: number;
    skipped: number;
    timeouts: number;
  };
  findings: Finding[];
}

/**
 * Parse the prover's textual output. Designed to handle both happy-path
 * runs ("All N specs verified") and assorted failure shapes. The parser
 * walks the combined stdout+stderr lines and pulls out:
 *
 *   - explicit Boogie verification verdicts
 *   - parser/compile errors (the prover surfaces them with "error:")
 *   - timeout banners
 *   - abort-condition diagnostics ("function may abort, no asserts(...)")
 *
 * Anything that doesn't match a known pattern but smells like an error
 * (contains "error", "failed", "could not be proved") is captured as
 * kind="unknown" so the caller can still surface it.
 */
export function parseProverOutput(stdout: string, stderr: string, exitCode: number): ParsedOutput {
  const findings: Finding[] = [];
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split('\n');

  let verified = 0;
  let failed = 0;
  let skipped = 0;
  let timeouts = 0;

  // "Verifying foo_spec" / "verified foo_spec" / "FAILED: bar_spec"
  // (We accept several capitalisations because the binary's wording has
  // drifted between rungs.)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // 1. Summary counters
    const sumMatch = line.match(/(\d+)\s+specs?\s+verified/i);
    if (sumMatch) verified += parseInt(sumMatch[1]!, 10);

    if (/\bskipped\b/i.test(line)) {
      const m = line.match(/(\d+)\s+(?:specs?\s+)?skipped/i);
      if (m) skipped += parseInt(m[1]!, 10);
    }

    // 2. Explicit per-spec verdicts
    const failedSpec = line.match(/(?:FAILED|verification failed)\s*[:\-]?\s*([\w:]+)/i);
    if (failedSpec) {
      const specName = failedSpec[1]!;
      const surroundingContext = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 10)).join('\n');
      findings.push({
        kind: classifyFailureKind(surroundingContext),
        severity: 'error',
        message: line.trim(),
        location: findLocationNear(lines, i),
        spec: specName.includes('::') ? specName : null,
        function_under_test: deriveFunctionUnderTest(specName),
        counterexample: extractCounterexample(lines, i),
      });
      failed += 1;
      continue;
    }

    // 3. Timeout banner
    if (/timed out|timeout exceeded/i.test(line)) {
      timeouts += 1;
      findings.push({
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

    // 4. Compile errors / Move parser errors emitted upstream of the
    //    verification stage.
    if (/^error\b/i.test(line.trim())) {
      findings.push({
        kind: line.toLowerCase().includes('parse') ? 'parse_error' : 'compile_error',
        severity: 'error',
        message: line.trim(),
        location: findLocationNear(lines, i),
        spec: null,
        function_under_test: null,
        counterexample: null,
      });
    }

    // 5. Abort-unspecified diagnostic (the prover hint when a function
    //    can abort but no asserts() covers the path).
    if (/may abort|abort condition (?:not|un)specified/i.test(line)) {
      findings.push({
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

  // If the binary exited non-zero but we somehow have no findings, surface
  // an "unknown" catch-all so the caller knows something went wrong without
  // having to parse raw output themselves.
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

  return {
    summary: { verified, failed, skipped, timeouts },
    findings,
  };
}

/** Classify failure kind from a window of surrounding context. */
function classifyFailureKind(context: string): FindingKind {
  if (/ensures (?:may not hold|failed)/i.test(context)) return 'ensures_failed';
  if (/asserts (?:may not hold|failed)/i.test(context)) return 'asserts_failed';
  if (/no spec for|missing spec/i.test(context)) return 'no_spec';
  if (/timeout|timed out/i.test(context)) return 'timeout';
  return 'unknown';
}

/**
 * Scan a small window of lines around index `i` for a `file:line:col`
 * pointer. Conservative: returns null when no clear pointer is found
 * rather than guessing.
 */
function findLocationNear(lines: string[], i: number): FindingLocation | null {
  for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 5); j++) {
    const line = lines[j]!;
    // Match: /abs/or/relative/path.move:LINE:COL or path.move:LINE
    const m = line.match(/([^\s:]+\.move):(\d+)(?::(\d+))?/);
    if (m) {
      return { file: m[1]!, line: parseInt(m[2]!, 10), col: m[3] ? parseInt(m[3], 10) : 0 };
    }
  }
  return null;
}

/**
 * Spec naming convention from asymptotic-code/sui-kit examples:
 *   foo_spec  -> target foo
 *   foo::bar::baz_spec -> target foo::bar::baz
 *
 * Returns null if the name doesn't look like a *_spec.
 */
function deriveFunctionUnderTest(specName: string): string | null {
  const m = specName.match(/^(.+)_spec$/);
  return m ? m[1]! : null;
}

function extractSpecFromLine(line: string): string | null {
  const m = line.match(/(\b[\w]+_spec\b)/);
  return m ? m[1]! : null;
}

function extractFqnFromLine(line: string): string | null {
  // Match a Move fully-qualified name (pkg::mod::fn) but tolerate
  // shorter forms like mod::fn.
  const m = line.match(/\b([a-zA-Z_][\w]*(?:::[a-zA-Z_][\w]*)+)\b/);
  return m ? m[1]! : null;
}

/**
 * Extract a counterexample block, if present. The prover emits
 * "Counterexample:" followed by a sequence of `var = value` lines until
 * the next blank line or the next "Spec ..." header.
 */
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
