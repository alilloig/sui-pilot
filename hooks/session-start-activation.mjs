// src/session-start-activation.mts
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { safeReadJson } from "./hook-env.mjs";
var ACTIVATION_MARKER_FILES = [
  "Move.toml",
  "sui_move.toml"
];
var ACTIVATION_MARKER_DIRS = [
  "sources",
  // Move package source convention
  ".sui"
  // local sui CLI cache (rare but unambiguous)
];
function readPackageJson(projectRoot) {
  return safeReadJson(join(projectRoot, "package.json"));
}
function packageJsonSignalsSui(projectRoot) {
  const pkg = readPackageJson(projectRoot);
  if (!pkg) return false;
  const allDeps = {
    ...pkg.dependencies || {},
    ...pkg.devDependencies || {}
  };
  if (Object.keys(allDeps).some((dep) => dep.startsWith("@mysten/"))) {
    return true;
  }
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  return Object.values(scripts).some(
    (value) => typeof value === "string" && /\bsui\s+(client|move|keytool|ptb)\b/.test(value)
  );
}
function hasMoveSourceFiles(projectRoot) {
  let entries;
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
      }
    }
  }
  return false;
}
function hasSessionStartActivationMarkers(projectRoot) {
  if (ACTIVATION_MARKER_FILES.some((file) => existsSync(join(projectRoot, file)))) {
    return true;
  }
  if (ACTIVATION_MARKER_DIRS.some((dir) => existsSync(join(projectRoot, dir)))) {
    return true;
  }
  if (hasMoveSourceFiles(projectRoot)) return true;
  return packageJsonSignalsSui(projectRoot);
}
function isGreenfieldDirectory(projectRoot) {
  let dirents;
  try {
    dirents = readdirSync(projectRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  const hasNonDotDir = dirents.some((d) => !d.name.startsWith("."));
  const hasDotFile = dirents.some((d) => d.name.startsWith(".") && d.isFile());
  return !hasNonDotDir && !hasDotFile;
}
export {
  hasSessionStartActivationMarkers,
  isGreenfieldDirectory
};
