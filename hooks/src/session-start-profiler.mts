/**
 * Session-start repo profiler hook for sui-pilot.
 *
 * Scans the current working directory for Move.toml, Sui project conventions,
 * and `@mysten/*` package.json deps, then persists likely skill slugs and
 * greenfield state for the active session. Pre-primes the skill matcher so
 * the first tool call can skip cold-scanning.
 *
 * Claude-Code-only: writes session-scoped values to /tmp dedup files and
 * emits any user-visible greenfield messages to stdout.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  type Dirent,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeInput } from "./compat.mjs";
import { pluginRoot, safeReadJson, writeSessionFile } from "./hook-env.mjs";
import { createLogger, logCaughtError, type Logger } from "./logger.mjs";
import { hasSessionStartActivationMarkers } from "./session-start-activation.mjs";
import { buildSkillMap } from "./skill-map-frontmatter.mjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileMarker {
  file: string;
  skills: string[];
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, unknown>;
  [key: string]: unknown;
}

interface BootstrapSignals {
  bootstrapHints: string[];
  resourceHints: string[];
  setupMode: boolean;
}

interface GreenfieldResult {
  entries: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Mapping from marker file -> skill slugs. Move/Sui-shaped projects.
 */
const FILE_MARKERS: FileMarker[] = [
  { file: "Move.toml", skills: ["move-code-quality", "move-code-review", "move-tests"] },
  { file: "Move.lock", skills: ["move-code-quality"] },
];

/**
 * Dependency names in package.json -> skill slugs.
 * Mostly TS-SDK-shaped — Move-side detection lives in FILE_MARKERS.
 */
const PACKAGE_MARKERS: Record<string, string[]> = {
  "@mysten/sui": ["move-code-review"],
  "@mysten/dapp-kit": ["move-code-review"],
  "@mysten/dapp-kit-react": ["move-code-review"],
  "@mysten/wallet-standard": ["move-code-review"],
  "@mysten/walrus": ["move-code-review"],
  "@mysten/seal": ["move-code-review"],
  "@mysten/kiosk": ["move-code-review"],
  "@mysten/deepbook-v3": ["move-code-review", "oz-math"],
  "@mysten/payment-kit": ["move-code-review"],
};

const SETUP_DEPENDENCY_HINTS: Record<string, string> = {
  "@mysten/sui": "ts-sdk",
  "@mysten/dapp-kit": "dapp-kit",
  "@mysten/dapp-kit-react": "dapp-kit",
  "@mysten/walrus": "walrus",
  "@mysten/seal": "seal",
};

const SETUP_SCRIPT_MARKERS: string[] = [
  "sui move build",
  "sui move test",
  "sui client publish",
  "sui client call",
];

const SETUP_MODE_THRESHOLD = 3;

const GREENFIELD_DEFAULT_SKILLS: string[] = [
  "move-code-quality",
  "move-tests",
];

const GREENFIELD_SETUP_SIGNALS: BootstrapSignals = {
  bootstrapHints: ["greenfield"],
  resourceHints: [],
  setupMode: true,
};

const SESSION_GREENFIELD_KIND = "greenfield";
const SESSION_LIKELY_SKILLS_KIND = "likely-skills";

const log: Logger = createLogger();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPackageJson(projectRoot: string): PackageJson | null {
  return safeReadJson<PackageJson>(join(projectRoot, "package.json"));
}

function hasMoveSourceFiles(projectRoot: string): boolean {
  // Cheap one-level deep scan; activation already happened, so we can afford to look harder.
  let entries: Dirent[];
  try {
    entries = readdirSync(projectRoot, { withFileTypes: true });
  } catch (error) {
    logCaughtError(log, "session-start-profiler:has-move-files-readdir-failed", error, { projectRoot });
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".move")) return true;
    if (entry.isDirectory() && (entry.name === "sources" || entry.name === "tests")) {
      try {
        const inner = readdirSync(join(projectRoot, entry.name), { withFileTypes: true });
        if (inner.some((d: Dirent) => d.isFile() && d.name.endsWith(".move"))) return true;
      } catch {
        // ignore unreadable subdir
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Exported profilers
// ---------------------------------------------------------------------------

export function profileProject(projectRoot: string): string[] {
  const skills: Set<string> = new Set();

  // 1. Check marker files
  for (const marker of FILE_MARKERS) {
    if (existsSync(join(projectRoot, marker.file))) {
      for (const s of marker.skills) skills.add(s);
    }
  }

  // 2. Move source files anywhere → Move skills relevant
  if (hasMoveSourceFiles(projectRoot)) {
    skills.add("move-code-quality");
    skills.add("move-code-review");
    skills.add("move-tests");
  }

  // 3. Check package.json dependencies (TS-side @mysten/* signals)
  const pkg: PackageJson | null = readPackageJson(projectRoot);
  if (pkg) {
    const allDeps: Record<string, string> = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    for (const [dep, skillSlugs] of Object.entries(PACKAGE_MARKERS)) {
      if (dep in allDeps) {
        for (const s of skillSlugs) skills.add(s);
      }
    }
  }

  return [...skills].sort();
}

export function profileBootstrapSignals(projectRoot: string): BootstrapSignals {
  const bootstrapHints: Set<string> = new Set();
  const resourceHints: Set<string> = new Set();

  // README* signal — common bootstrap indicator
  try {
    const dirents: Dirent[] = readdirSync(projectRoot, { withFileTypes: true });
    if (dirents.some((d: Dirent) => d.isFile() && d.name.toLowerCase().startsWith("readme"))) {
      bootstrapHints.add("readme");
    }
    if (dirents.some((d: Dirent) => d.isDirectory() && d.name === "sources")) {
      bootstrapHints.add("move-package");
    }
  } catch (error) {
    logCaughtError(log, "session-start-profiler:profile-bootstrap-signals-readdir-failed", error, { projectRoot });
  }

  // Move.toml signals a Move package; a tests/ subdir alongside it = test-shaped intent
  if (existsSync(join(projectRoot, "Move.toml"))) {
    bootstrapHints.add("move-toml");
  }
  if (existsSync(join(projectRoot, "tests"))) {
    bootstrapHints.add("move-tests-dir");
  }

  // package.json scripts + deps
  const pkg: PackageJson | null = readPackageJson(projectRoot);
  if (pkg) {
    const scripts: Record<string, unknown> =
      pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
    const scriptEntries: string = Object.entries(scripts)
      .map(([name, cmd]: [string, unknown]) => `${name} ${typeof cmd === "string" ? cmd : ""}`)
      .join("\n");

    for (const marker of SETUP_SCRIPT_MARKERS) {
      if (scriptEntries.includes(marker)) {
        bootstrapHints.add(marker.replace(/\s+/g, "-"));
      }
    }

    const allDeps: Record<string, string> = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    for (const dep of Object.keys(allDeps)) {
      const resource: string | undefined = SETUP_DEPENDENCY_HINTS[dep];
      if (resource) {
        bootstrapHints.add(resource);
        resourceHints.add(resource);
      }
    }
  }

  const hints: string[] = [...bootstrapHints].sort();
  const resources: string[] = [...resourceHints].sort();
  return {
    bootstrapHints: hints,
    resourceHints: resources,
    setupMode: hints.length >= SETUP_MODE_THRESHOLD,
  };
}

export function checkGreenfield(projectRoot: string): GreenfieldResult | null {
  let dirents: Dirent[];
  try {
    dirents = readdirSync(projectRoot, { withFileTypes: true });
  } catch (error) {
    logCaughtError(log, "session-start-profiler:check-greenfield-readdir-failed", error, { projectRoot });
    return null;
  }

  const hasNonDotDir: boolean = dirents.some((d: Dirent) => !d.name.startsWith("."));
  const hasDotFile: boolean = dirents.some((d: Dirent) => d.name.startsWith(".") && d.isFile());

  if (!hasNonDotDir && !hasDotFile) {
    return { entries: dirents.map((d: Dirent) => d.name).sort() };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

interface SessionStartInput {
  session_id?: string;
  workspace_roots?: string[];
  cwd?: string;
  [key: string]: unknown;
}

export function parseSessionStartInput(raw: string): SessionStartInput | null {
  try {
    if (!raw.trim()) return null;
    return JSON.parse(raw) as SessionStartInput;
  } catch {
    return null;
  }
}

export function normalizeSessionStartSessionId(input: SessionStartInput | null): string | null {
  if (!input) return null;
  const sessionId = normalizeInput(input as Record<string, unknown>).sessionId;
  return sessionId || null;
}

export function resolveSessionStartProjectRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_PROJECT_ROOT ?? process.cwd();
}

function collectBrokenSkillFrontmatterNames(files: string[]): string[] {
  return [...new Set(
    files
      .map((file: string) => file.replaceAll("\\", "/").split("/").at(-2) || "")
      .filter((skill: string) => skill !== ""),
  )].sort();
}

export function logBrokenSkillFrontmatterSummary(
  rootDir: string = pluginRoot(),
  logger: Logger = log,
): string | null {
  if (!logger.isEnabled("summary")) return null;

  try {
    const built = buildSkillMap(join(rootDir, "skills"));
    const brokenSkills = collectBrokenSkillFrontmatterNames(
      built.diagnostics.map((diagnostic) => diagnostic.file),
    );

    if (brokenSkills.length === 0) return null;

    const message = `WARNING: ${brokenSkills.length} skills have broken frontmatter: ${brokenSkills.join(", ")}`;
    logger.summary("session-start-profiler:broken-skill-frontmatter", {
      message,
      brokenSkillCount: brokenSkills.length,
      brokenSkills,
    });
    return message;
  } catch (error) {
    logCaughtError(logger, "session-start-profiler:broken-skill-frontmatter-check-failed", error, { rootDir });
    return null;
  }
}

export function buildSessionStartProfilerEnvVars(args: {
  greenfield: boolean;
  likelySkills: string[];
  setupSignals: BootstrapSignals;
}): Record<string, string> {
  const envVars: Record<string, string> = {};

  if (args.greenfield) {
    envVars.SUI_PILOT_GREENFIELD = "true";
  }
  if (args.likelySkills.length > 0) {
    envVars.SUI_PILOT_LIKELY_SKILLS = args.likelySkills.join(",");
  }
  if (args.setupSignals.bootstrapHints.length > 0) {
    envVars.SUI_PILOT_BOOTSTRAP_HINTS = args.setupSignals.bootstrapHints.join(",");
  }
  if (args.setupSignals.resourceHints.length > 0) {
    envVars.SUI_PILOT_RESOURCE_HINTS = args.setupSignals.resourceHints.join(",");
  }
  if (args.setupSignals.setupMode) {
    envVars.SUI_PILOT_SETUP_MODE = "1";
  }

  return envVars;
}

export function buildSessionStartProfilerUserMessages(
  greenfield: GreenfieldResult | null,
): string[] {
  const messages: string[] = [];

  if (greenfield) {
    messages.push(
      "This is a greenfield project. Skip exploration — there is no existing code to discover. Start executing immediately.",
    );
  }

  return messages;
}

function main(): void {
  const hookInput = parseSessionStartInput(readFileSync(0, "utf8"));
  const sessionId = normalizeSessionStartSessionId(hookInput);
  const projectRoot = resolveSessionStartProjectRoot();

  const greenfield: GreenfieldResult | null = checkGreenfield(projectRoot);
  const shouldActivate = greenfield !== null
    || !existsSync(projectRoot)
    || hasSessionStartActivationMarkers(projectRoot);

  if (!shouldActivate) {
    log.debug("session-start-profiler:skipped-non-sui-project", {
      projectRoot,
      reason: "non-empty-without-sui-markers",
    });

    if (sessionId) {
      writeSessionFile(sessionId, SESSION_GREENFIELD_KIND, "");
      writeSessionFile(sessionId, SESSION_LIKELY_SKILLS_KIND, "");
    }

    process.exit(0);
  }

  logBrokenSkillFrontmatterSummary();

  const userMessages = buildSessionStartProfilerUserMessages(greenfield);

  const likelySkills: string[] = greenfield
    ? GREENFIELD_DEFAULT_SKILLS
    : profileProject(projectRoot);

  const setupSignals: BootstrapSignals = greenfield
    ? GREENFIELD_SETUP_SIGNALS
    : profileBootstrapSignals(projectRoot);

  const greenfieldValue = greenfield ? "true" : "";
  const likelySkillsValue = likelySkills.join(",");

  if (sessionId) {
    writeSessionFile(sessionId, SESSION_GREENFIELD_KIND, greenfieldValue);
    writeSessionFile(sessionId, SESSION_LIKELY_SKILLS_KIND, likelySkillsValue);
  }

  const additionalContext = userMessages.join("\n\n");
  if (additionalContext) {
    process.stdout.write(`${additionalContext}\n\n`);
  }

  process.exit(0);
}

const SESSION_START_PROFILER_ENTRYPOINT = fileURLToPath(import.meta.url);
const isSessionStartProfilerEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === SESSION_START_PROFILER_ENTRYPOINT
  : false;

if (isSessionStartProfilerEntrypoint) {
  main();
}
