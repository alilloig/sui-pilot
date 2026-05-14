/**
 * Scan a package (or a single file) for `#[spec(...)]` decorations on
 * `fun` declarations. The sui-prover binary does NOT expose a "list
 * existing specs" command, so the `specify` skill needs this for both
 * idempotency (don't re-spec what already has a spec) and resume
 * (pick up where a prior session left off).
 *
 * Parser shape: regex-based, comment-aware. We strip line and block
 * comments before scanning so that example specs commented out for
 * debugging don't show up as live entries.
 */

import { readFileSync, statSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

export interface SpecEntry {
  file: string;             // absolute path
  line: number;             // 1-based, points to the `fun NAME` line
  function_name: string;    // e.g. "withdraw_spec"
  target: string | null;    // pkg::mod::fn from `target = ...` attr; null if colocated
  attrs: string[];          // attribute params: ["prove", "no_opaque", "focus", ...]
}

export interface ListSpecsResult {
  package_path: string;
  specs: SpecEntry[];
  files_scanned: number;
}

/**
 * Scan recursively from a starting directory or single file. When given
 * a file, only that file is scanned. When given a directory, every .move
 * file under it (recursively) is scanned. Build directories are skipped
 * to avoid recompiled byproducts.
 */
export function listSpecs(startPath: string): ListSpecsResult {
  const absStart = resolve(startPath);
  const stat = statSync(absStart);
  const moveFiles: string[] = [];

  if (stat.isFile()) {
    if (absStart.endsWith('.move')) moveFiles.push(absStart);
  } else {
    collectMoveFiles(absStart, moveFiles);
  }

  const specs: SpecEntry[] = [];
  for (const file of moveFiles) {
    const text = readFileSync(file, 'utf8');
    const stripped = stripComments(text);
    specs.push(...findSpecsInSource(stripped, file));
  }

  return { package_path: absStart, specs, files_scanned: moveFiles.length };
}

function collectMoveFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'build' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMoveFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.move')) {
      out.push(full);
    }
  }
}

/**
 * Strip line and block comments. Keeps newlines so line numbers stay
 * aligned with the original source.
 */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * Find every `#[spec(...)] ... fun NAME` pattern in a comment-stripped
 * source. Accepts attribute blocks that span multiple lines and
 * optional `public` / `entry` / `native` modifiers between the
 * attribute and the `fun` keyword.
 */
export function findSpecsInSource(stripped: string, file: string): SpecEntry[] {
  // Capture the entire spec-attribute argument list (between the parens),
  // including newlines, then any qualifier tokens leading up to `fun NAME`.
  const re = /#\[\s*spec\s*\(([^)]*)\)\s*\](?:\s*#\[[^\]]*\])*\s*(?:public(?:\s*\(\s*package\s*\))?\s+|entry\s+|native\s+|macro\s+)*fun\s+([A-Za-z_][A-Za-z0-9_]*)/g;

  const specs: SpecEntry[] = [];
  for (const match of stripped.matchAll(re)) {
    const argList = match[1]!;
    const funName = match[2]!;
    const offset = match.index ?? 0;
    specs.push({
      file,
      line: lineNumberAt(stripped, offset),
      function_name: funName,
      target: extractTarget(argList),
      attrs: extractAttrTokens(argList),
    });
  }
  return specs;
}

function lineNumberAt(text: string, offset: number): number {
  // 1-based line counter for the offset's position in the stripped source.
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* newline */) line += 1;
  }
  return line;
}

function extractTarget(argList: string): string | null {
  // Cross-module target paths take two shapes per .sui-prover-docs:
  //   `target = pkg_name::mod::fn`              (identifier-prefixed)
  //   `target = 0x2::transfer::public_transfer` (hex-address-prefixed)
  // The identifier form starts with a letter or underscore; the address
  // form is `0x` followed by hex digits. Both forms then require at
  // least one `::segment` to count as a Move path.
  const match = argList.match(
    /target\s*=\s*((?:0x[0-9a-fA-F]+|[A-Za-z_]\w*)(?:::[A-Za-z_]\w*)+)/
  );
  return match ? match[1]! : null;
}

/**
 * Split the attribute argument list into tokens. Drops the leading
 * `prove` / `skip` / `focus` mode tokens too -- those are returned as
 * the first element so callers can branch on mode if they want.
 */
function extractAttrTokens(argList: string): string[] {
  return argList
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      // Normalise `key = value` to `key=value` so the string is grep-safe.
      const eq = s.indexOf('=');
      if (eq === -1) return s;
      return `${s.slice(0, eq).trim()}=${s.slice(eq + 1).trim()}`;
    });
}
