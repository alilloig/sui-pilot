import { existsSync, readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { safeReadJson } from "./hook-env.mjs";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, unknown>;
}

// Files that, on their own, signal a Move/Sui project the moment they exist.
const ACTIVATION_MARKER_FILES: string[] = [
  "Move.toml",
  "sui_move.toml",
];

// Directories whose presence is itself a strong signal.
const ACTIVATION_MARKER_DIRS: string[] = [
  "sources", // Move package source convention
  ".sui",    // local sui CLI cache (rare but unambiguous)
];

function readPackageJson(projectRoot: string): PackageJson | null {
  return safeReadJson<PackageJson>(join(projectRoot, "package.json"));
}

function packageJsonSignalsSui(projectRoot: string): boolean {
  const pkg = readPackageJson(projectRoot);
  if (!pkg) return false;

  const allDeps: Record<string, string> = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  if (Object.keys(allDeps).some((dep: string) => dep.startsWith("@mysten/"))) {
    return true;
  }

  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  return Object.values(scripts).some((value: unknown) =>
    typeof value === "string" && /\bsui\s+(client|move|keytool|ptb)\b/.test(value),
  );
}

function hasMoveSourceFiles(projectRoot: string): boolean {
  // Cheap recursive look one level deep. Avoids walking node_modules.
  let entries: Dirent[];
  try {
    entries = readdirSync(projectRoot, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".move")) return true;
    if (entry.isDirectory() && entry.name === "sources") {
      try {
        const inner = readdirSync(join(projectRoot, "sources"), { withFileTypes: true });
        if (inner.some((d) => d.isFile() && d.name.endsWith(".move"))) return true;
      } catch {
        // ignore — directory may be unreadable
      }
    }
  }
  return false;
}

export function hasSessionStartActivationMarkers(projectRoot: string): boolean {
  if (ACTIVATION_MARKER_FILES.some((file: string) => existsSync(join(projectRoot, file)))) {
    return true;
  }

  if (ACTIVATION_MARKER_DIRS.some((dir: string) => existsSync(join(projectRoot, dir)))) {
    return true;
  }

  if (hasMoveSourceFiles(projectRoot)) return true;

  return packageJsonSignalsSui(projectRoot);
}

export function isGreenfieldDirectory(projectRoot: string): boolean {
  let dirents: Dirent[];
  try {
    dirents = readdirSync(projectRoot, { withFileTypes: true });
  } catch {
    return false;
  }

  const hasNonDotDir = dirents.some((d: Dirent) => !d.name.startsWith("."));
  const hasDotFile = dirents.some((d: Dirent) => d.name.startsWith(".") && d.isFile());
  return !hasNonDotDir && !hasDotFile;
}
