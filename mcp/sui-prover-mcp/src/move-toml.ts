/**
 * Lightweight Move.toml inspection. We don't need a full TOML parser --
 * the prover-relevant signals are simple line patterns:
 *
 *   - package name and edition (from the [package] section)
 *   - presence of explicit `Sui = { ... }` or `MoveStdlib = { ... }`
 *     dependencies (these disable Sui 1.45+ implicit-dep injection
 *     per the breaking-deps forum post, which the prover relies on)
 *
 * The setup-warning surface lets the wrapper inform the user without
 * editing their Move.toml -- per the plan's "wrapper must not auto-edit
 * user files" rule.
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { MoveTomlNotFoundError } from './errors.js';

export interface PackageInfo {
  path: string;          // absolute path to the package root (dir of Move.toml)
  movetomlPath: string;  // absolute path to Move.toml itself
  name: string | null;
  edition: string | null;
  explicitFrameworkDeps: string[]; // ["Sui", "MoveStdlib", ...] when found
}

export interface GitDependency {
  name: string;            // dependency block name, e.g. "utilities"
  url: string;             // git URL, e.g. "git@github.com:Org/repo.git"
  rev?: string | null;     // branch/tag/commit if declared
  subdir?: string | null;  // optional subdir under the repo
}

/**
 * Walk up from `start` (file or dir) until a Move.toml is found. Returns
 * the directory containing Move.toml. Throws MoveTomlNotFoundError if the
 * walk reaches the filesystem root without finding one.
 */
export function findPackageRoot(start: string): string {
  let dir = resolve(start);
  // If start is a file, begin from its parent.
  try {
    const stat = statSync(dir);
    if (stat.isFile()) dir = dirname(dir);
  } catch {
    // If statSync fails (path missing), just walk up from the resolved dir.
  }

  while (true) {
    if (existsSync(join(dir, 'Move.toml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new MoveTomlNotFoundError(start);
}

/**
 * Inspect a Move.toml file (or its enclosing package) and return parsed
 * facts plus a list of explicit framework deps that would disable
 * implicit-dep injection.
 */
export function inspectPackage(packagePath: string): PackageInfo {
  const dir = packagePath.endsWith('Move.toml') ? dirname(packagePath) : packagePath;
  const movetomlPath = join(dir, 'Move.toml');
  if (!existsSync(movetomlPath)) throw new MoveTomlNotFoundError(dir);

  const raw = readFileSync(movetomlPath, 'utf8');

  return {
    path: dir,
    movetomlPath,
    name: extractField(raw, 'name'),
    edition: extractField(raw, 'edition'),
    explicitFrameworkDeps: detectExplicitFrameworkDeps(raw),
  };
}

/**
 * Extract a single-line scalar field from the [package] section.
 * Tolerates both `name = "foo"` and `name="foo"` spacing.
 */
function extractField(toml: string, field: string): string | null {
  // Only scan the [package] block to avoid matching identically-named keys
  // in [addresses] or other sections. JavaScript regex has no \Z anchor;
  // an end-of-input lookahead `$(?![\s\S])` is the correct form (also used
  // by detectExplicitFrameworkDeps below). The earlier `\Z` literal-Z
  // truncated the scope at any `Z` character inside the [package] block,
  // breaking `name`/`edition` extraction for any package whose values
  // contained an uppercase Z.
  const pkgMatch = toml.match(/\[package\][\s\S]*?(?=^\[[\w-]+\]|$(?![\s\S]))/m);
  const scope = pkgMatch ? pkgMatch[0] : toml;
  const re = new RegExp(`^\\s*${field}\\s*=\\s*"([^"]+)"`, 'm');
  const m = scope.match(re);
  return m ? m[1]! : null;
}

/**
 * Parse git dependency declarations from a Move.toml string. Recognizes both
 * the block form (`[dependencies.NAME]` with a `git = "..."` line) and the
 * inline form (`NAME = { git = "...", rev = "...", subdir = "..." }`).
 *
 * Pure string parsing — no shell-outs. Used by `prover_capabilities` to
 * surface the dep list so the caller can probe reachability itself.
 */
export function parseGitDependencies(toml: string): GitDependency[] {
  const out: GitDependency[] = [];

  // Block form: [dependencies.NAME] followed by indented `git = "..."` etc
  const blockRe = /\[dependencies\.([\w-]+)\]([\s\S]*?)(?=^\[|$(?![\s\S]))/gm;
  for (const m of toml.matchAll(blockRe)) {
    const name = m[1]!;
    const body = m[2]!;
    const gitMatch = body.match(/^\s*git\s*=\s*"([^"]+)"/m);
    if (!gitMatch) continue;
    const revMatch = body.match(/^\s*rev\s*=\s*"([^"]+)"/m);
    const subdirMatch = body.match(/^\s*subdir\s*=\s*"([^"]+)"/m);
    out.push({
      name,
      url: gitMatch[1]!,
      rev: revMatch ? revMatch[1]! : null,
      subdir: subdirMatch ? subdirMatch[1]! : null,
    });
  }

  // Inline form inside [dependencies]: NAME = { git = "...", rev = "...", subdir = "..." }
  const depSection = toml.match(/\[dependencies\][\s\S]*?(?=^\[[\w-]+\]|$(?![\s\S]))/m);
  if (depSection) {
    const inlineRe = /^\s*([\w-]+)\s*=\s*\{([^}]*)\}/gm;
    for (const m of depSection[0].matchAll(inlineRe)) {
      const name = m[1]!;
      const inner = m[2]!;
      const gitMatch = inner.match(/\bgit\s*=\s*"([^"]+)"/);
      if (!gitMatch) continue;
      if (out.some((d) => d.name === name)) continue;
      const revMatch = inner.match(/\brev\s*=\s*"([^"]+)"/);
      const subdirMatch = inner.match(/\bsubdir\s*=\s*"([^"]+)"/);
      out.push({
        name,
        url: gitMatch[1]!,
        rev: revMatch ? revMatch[1]! : null,
        subdir: subdirMatch ? subdirMatch[1]! : null,
      });
    }
  }

  return out;
}

/**
 * Detect explicit Sui / MoveStdlib / SuiSystem / Bridge / Deepbook deps.
 * Per the Sui 1.45 breaking-deps post, *any* of these as explicit entries
 * disables implicit-dep injection for the package -- which the prover
 * SKILL.md instructs users to remove.
 *
 * Matches against the [dependencies] section header (case-insensitive
 * key names; TOML keys are case-sensitive but framework crates have
 * stable PascalCase names that show up consistently in the wild).
 */
export function detectExplicitFrameworkDeps(toml: string): string[] {
  const FRAMEWORK_DEPS = ['Sui', 'MoveStdlib', 'SuiSystem', 'Bridge', 'Deepbook', 'DeepBook'];
  const found: string[] = [];

  // Scope to the [dependencies] section -- captures from the header up to
  // the next top-level section header or end-of-string. JavaScript regex
  // has no \Z anchor; rely on the `m` flag plus an end-of-input
  // alternative.
  const depMatch = toml.match(/\[dependencies\][\s\S]*?(?=^\[[\w-]+\]|$(?![\s\S]))/m);
  const scope = depMatch ? depMatch[0] : '';
  if (!scope) return found;

  for (const dep of FRAMEWORK_DEPS) {
    const re = new RegExp(`^\\s*${dep}\\s*=`, 'm');
    if (re.test(scope) && !found.includes(dep)) found.push(dep);
  }
  return found;
}
