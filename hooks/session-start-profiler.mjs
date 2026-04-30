// src/session-start-profiler.mts
import {
  existsSync,
  readFileSync,
  readdirSync
} from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { normalizeInput, setSessionEnv } from "./compat.mjs";
import { pluginRoot, safeReadJson, writeSessionFile } from "./hook-env.mjs";
import { createLogger, logCaughtError } from "./logger.mjs";
import { hasSessionStartActivationMarkers } from "./session-start-activation.mjs";
import { buildSkillMap } from "./skill-map-frontmatter.mjs";
var FILE_MARKERS = [
  { file: "Move.toml", skills: ["move-code-quality", "move-code-review", "move-tests"] },
  { file: "Move.lock", skills: ["move-code-quality"] }
];
var PACKAGE_MARKERS = {
  "@mysten/sui": ["move-code-review"],
  "@mysten/dapp-kit": ["move-code-review"],
  "@mysten/dapp-kit-react": ["move-code-review"],
  "@mysten/wallet-standard": ["move-code-review"],
  "@mysten/walrus": ["move-code-review"],
  "@mysten/seal": ["move-code-review"],
  "@mysten/kiosk": ["move-code-review"],
  "@mysten/deepbook-v3": ["move-code-review", "oz-math"],
  "@mysten/payment-kit": ["move-code-review"]
};
var SETUP_DEPENDENCY_HINTS = {
  "@mysten/sui": "ts-sdk",
  "@mysten/dapp-kit": "dapp-kit",
  "@mysten/dapp-kit-react": "dapp-kit",
  "@mysten/walrus": "walrus",
  "@mysten/seal": "seal"
};
var SETUP_SCRIPT_MARKERS = [
  "sui move build",
  "sui move test",
  "sui client publish",
  "sui client call"
];
var SETUP_MODE_THRESHOLD = 3;
var GREENFIELD_DEFAULT_SKILLS = [
  "move-code-quality",
  "move-tests"
];
var GREENFIELD_SETUP_SIGNALS = {
  bootstrapHints: ["greenfield"],
  resourceHints: [],
  setupMode: true
};
var SESSION_GREENFIELD_KIND = "greenfield";
var SESSION_LIKELY_SKILLS_KIND = "likely-skills";
var log = createLogger();
function readPackageJson(projectRoot) {
  return safeReadJson(join(projectRoot, "package.json"));
}
function hasMoveSourceFiles(projectRoot) {
  let entries;
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
        if (inner.some((d) => d.isFile() && d.name.endsWith(".move"))) return true;
      } catch {
      }
    }
  }
  return false;
}
function profileProject(projectRoot) {
  const skills = /* @__PURE__ */ new Set();
  for (const marker of FILE_MARKERS) {
    if (existsSync(join(projectRoot, marker.file))) {
      for (const s of marker.skills) skills.add(s);
    }
  }
  if (hasMoveSourceFiles(projectRoot)) {
    skills.add("move-code-quality");
    skills.add("move-code-review");
    skills.add("move-tests");
  }
  const pkg = readPackageJson(projectRoot);
  if (pkg) {
    const allDeps = {
      ...pkg.dependencies || {},
      ...pkg.devDependencies || {}
    };
    for (const [dep, skillSlugs] of Object.entries(PACKAGE_MARKERS)) {
      if (dep in allDeps) {
        for (const s of skillSlugs) skills.add(s);
      }
    }
  }
  return [...skills].sort();
}
function profileBootstrapSignals(projectRoot) {
  const bootstrapHints = /* @__PURE__ */ new Set();
  const resourceHints = /* @__PURE__ */ new Set();
  try {
    const dirents = readdirSync(projectRoot, { withFileTypes: true });
    if (dirents.some((d) => d.isFile() && d.name.toLowerCase().startsWith("readme"))) {
      bootstrapHints.add("readme");
    }
    if (dirents.some((d) => d.isDirectory() && d.name === "sources")) {
      bootstrapHints.add("move-package");
    }
  } catch (error) {
    logCaughtError(log, "session-start-profiler:profile-bootstrap-signals-readdir-failed", error, { projectRoot });
  }
  if (existsSync(join(projectRoot, "Move.toml"))) {
    bootstrapHints.add("move-toml");
  }
  if (existsSync(join(projectRoot, "tests"))) {
    bootstrapHints.add("move-tests-dir");
  }
  const pkg = readPackageJson(projectRoot);
  if (pkg) {
    const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
    const scriptEntries = Object.entries(scripts).map(([name, cmd]) => `${name} ${typeof cmd === "string" ? cmd : ""}`).join("\n");
    for (const marker of SETUP_SCRIPT_MARKERS) {
      if (scriptEntries.includes(marker)) {
        bootstrapHints.add(marker.replace(/\s+/g, "-"));
      }
    }
    const allDeps = {
      ...pkg.dependencies || {},
      ...pkg.devDependencies || {}
    };
    for (const dep of Object.keys(allDeps)) {
      const resource = SETUP_DEPENDENCY_HINTS[dep];
      if (resource) {
        bootstrapHints.add(resource);
        resourceHints.add(resource);
      }
    }
  }
  const hints = [...bootstrapHints].sort();
  const resources = [...resourceHints].sort();
  return {
    bootstrapHints: hints,
    resourceHints: resources,
    setupMode: hints.length >= SETUP_MODE_THRESHOLD
  };
}
function checkGreenfield(projectRoot) {
  let dirents;
  try {
    dirents = readdirSync(projectRoot, { withFileTypes: true });
  } catch (error) {
    logCaughtError(log, "session-start-profiler:check-greenfield-readdir-failed", error, { projectRoot });
    return null;
  }
  const hasNonDotDir = dirents.some((d) => !d.name.startsWith("."));
  const hasDotFile = dirents.some((d) => d.name.startsWith(".") && d.isFile());
  if (!hasNonDotDir && !hasDotFile) {
    return { entries: dirents.map((d) => d.name).sort() };
  }
  return null;
}
function parseSessionStartInput(raw) {
  try {
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function normalizeSessionStartSessionId(input) {
  if (!input) return null;
  const sessionId = normalizeInput(input).sessionId;
  return sessionId || null;
}
function resolveSessionStartProjectRoot(env = process.env) {
  return env.CLAUDE_PROJECT_ROOT ?? process.cwd();
}
function collectBrokenSkillFrontmatterNames(files) {
  return [...new Set(
    files.map((file) => file.replaceAll("\\", "/").split("/").at(-2) || "").filter((skill) => skill !== "")
  )].sort();
}
function logBrokenSkillFrontmatterSummary(rootDir = pluginRoot(), logger = log) {
  if (!logger.isEnabled("summary")) return null;
  try {
    const built = buildSkillMap(join(rootDir, "skills"));
    const brokenSkills = collectBrokenSkillFrontmatterNames(
      built.diagnostics.map((diagnostic) => diagnostic.file)
    );
    if (brokenSkills.length === 0) return null;
    const message = `WARNING: ${brokenSkills.length} skills have broken frontmatter: ${brokenSkills.join(", ")}`;
    logger.summary("session-start-profiler:broken-skill-frontmatter", {
      message,
      brokenSkillCount: brokenSkills.length,
      brokenSkills
    });
    return message;
  } catch (error) {
    logCaughtError(logger, "session-start-profiler:broken-skill-frontmatter-check-failed", error, { rootDir });
    return null;
  }
}
function buildSessionStartProfilerEnvVars(args) {
  const envVars = {};
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
function buildSessionStartProfilerUserMessages(greenfield) {
  const messages = [];
  if (greenfield) {
    messages.push(
      "This is a greenfield project. Skip exploration \u2014 there is no existing code to discover. Start executing immediately."
    );
  }
  return messages;
}
function main() {
  const hookInput = parseSessionStartInput(readFileSync(0, "utf8"));
  const sessionId = normalizeSessionStartSessionId(hookInput);
  const projectRoot = resolveSessionStartProjectRoot();
  const greenfield = checkGreenfield(projectRoot);
  const shouldActivate = greenfield !== null || !existsSync(projectRoot) || hasSessionStartActivationMarkers(projectRoot);
  if (!shouldActivate) {
    log.debug("session-start-profiler:skipped-non-sui-project", {
      projectRoot,
      reason: "non-empty-without-sui-markers"
    });
    if (sessionId) {
      writeSessionFile(sessionId, SESSION_GREENFIELD_KIND, "");
      writeSessionFile(sessionId, SESSION_LIKELY_SKILLS_KIND, "");
    }
    process.exit(0);
  }
  logBrokenSkillFrontmatterSummary();
  const userMessages = buildSessionStartProfilerUserMessages(greenfield);
  const likelySkills = greenfield ? GREENFIELD_DEFAULT_SKILLS : profileProject(projectRoot);
  const setupSignals = greenfield ? GREENFIELD_SETUP_SIGNALS : profileBootstrapSignals(projectRoot);
  const greenfieldValue = greenfield ? "true" : "";
  const likelySkillsValue = likelySkills.join(",");
  if (sessionId) {
    writeSessionFile(sessionId, SESSION_GREENFIELD_KIND, greenfieldValue);
    writeSessionFile(sessionId, SESSION_LIKELY_SKILLS_KIND, likelySkillsValue);
  }
  const envVars = buildSessionStartProfilerEnvVars({
    greenfield: greenfield !== null,
    likelySkills,
    setupSignals
  });
  for (const [key, value] of Object.entries(envVars)) {
    setSessionEnv("claude-code", key, value);
  }
  const additionalContext = userMessages.join("\n\n");
  if (additionalContext) {
    process.stdout.write(`${additionalContext}

`);
  }
  process.exit(0);
}
var SESSION_START_PROFILER_ENTRYPOINT = fileURLToPath(import.meta.url);
var isSessionStartProfilerEntrypoint = process.argv[1] ? resolve(process.argv[1]) === SESSION_START_PROFILER_ENTRYPOINT : false;
if (isSessionStartProfilerEntrypoint) {
  main();
}
export {
  buildSessionStartProfilerEnvVars,
  buildSessionStartProfilerUserMessages,
  checkGreenfield,
  logBrokenSkillFrontmatterSummary,
  normalizeSessionStartSessionId,
  parseSessionStartInput,
  profileBootstrapSignals,
  profileProject,
  resolveSessionStartProjectRoot
};
