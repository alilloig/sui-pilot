#!/usr/bin/env node
// sui-pilot doctor: health check for the v2 plugin install.
// Verifies manifest, manifest/disk parity, agent preamble byte budget,
// sui.md SKILL_TO_CHUNK headings, hook script presence, and MCP bundle.
// Usage: bun run scripts/doctor.ts

import { resolve, join, dirname } from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const AGENT_BUDGET_BYTES = 4000;

// Mirrors hooks/src/sui-context.mts SKILL_TO_CHUNK — keep in sync.
const SKILL_TO_CHUNK_HEADINGS: Record<string, string> = {
  "move-code-quality": "Move type system & abilities",
  "move-code-review": "Sui object model",
  "move-pr-review": "Transactions & lifecycle",
  "move-tests": "Tooling",
  "oz-math": "Onchain finance & math",
};

interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail?: string;
}

const results: CheckResult[] = [];

function pass(name: string, detail?: string) { results.push({ name, status: "pass", detail }); }
function fail(name: string, detail: string) { results.push({ name, status: "fail", detail }); }
function warn(name: string, detail: string) { results.push({ name, status: "warn", detail }); }
function skip(name: string, detail: string) { results.push({ name, status: "skip", detail }); }

// 1 — manifest
const manifestPath = join(ROOT, "generated", "skill-manifest.json");
let manifestSlugs: string[] = [];
if (!existsSync(manifestPath)) {
  fail("manifest", `${manifestPath} missing — run 'node scripts/build-manifest.ts' first`);
} else {
  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.skills !== "object" || parsed.skills === null) {
      fail("manifest", "skill-manifest.json has no skills map");
    } else {
      manifestSlugs = Object.keys(parsed.skills).sort();
      pass("manifest", `parses; ${manifestSlugs.length} skills`);
    }
  } catch (err) {
    fail("manifest", `parse error: ${(err as Error).message}`);
  }
}

// 2 — manifest/disk parity
const skillsDir = join(ROOT, "skills");
if (existsSync(skillsDir)) {
  const onDisk = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
  const onlyOnDisk = onDisk.filter((s) => !manifestSlugs.includes(s));
  const onlyInManifest = manifestSlugs.filter((s) => !onDisk.includes(s));
  if (onlyOnDisk.length === 0 && onlyInManifest.length === 0) {
    pass("manifest/disk parity", `${onDisk.length} skills match`);
  } else {
    fail(
      "manifest/disk parity",
      [
        onlyOnDisk.length ? `only on disk: ${onlyOnDisk.join(", ")}` : "",
        onlyInManifest.length ? `only in manifest: ${onlyInManifest.join(", ")}` : "",
      ].filter(Boolean).join("; "),
    );
  }
} else {
  fail("manifest/disk parity", `skills/ missing at ${skillsDir}`);
}

// 3 — agent preamble byte budget
const agentFile = join(ROOT, "agents", "sui-pilot-agent.md");
if (!existsSync(agentFile)) {
  fail("agent preamble", "agents/sui-pilot-agent.md missing");
} else {
  const size = statSync(agentFile).size;
  if (size <= AGENT_BUDGET_BYTES) {
    pass("agent preamble", `${size} / ${AGENT_BUDGET_BYTES} bytes`);
  } else {
    fail("agent preamble", `${size} / ${AGENT_BUDGET_BYTES} bytes — over budget`);
  }
}

// 4 — sui.md + SKILL_TO_CHUNK headings
const suiMdPath = join(ROOT, "sui.md");
if (!existsSync(suiMdPath)) {
  fail("sui.md graph", "sui.md missing at plugin root");
} else {
  const content = readFileSync(suiMdPath, "utf-8");
  const missingHeadings: string[] = [];
  for (const [skill, heading] of Object.entries(SKILL_TO_CHUNK_HEADINGS)) {
    const re = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$`, "im");
    if (!re.test(content)) {
      missingHeadings.push(`${skill} → "${heading}"`);
    }
  }
  if (missingHeadings.length === 0) {
    pass("sui.md graph", `all ${Object.keys(SKILL_TO_CHUNK_HEADINGS).length} skill chunks resolve`);
  } else {
    fail("sui.md graph", `missing headings: ${missingHeadings.join("; ")}`);
  }
}

// 5 — hook scripts
const hooksDir = join(ROOT, "hooks");
const expectedHooks = [
  "session-start-seen-skills.mjs",
  "session-start-profiler.mjs",
  "inject-sui-context.mjs",
  "session-end-cleanup.mjs",
  "pretooluse-skill-inject.mjs",
  "user-prompt-submit-skill-inject.mjs",
];
const missingHooks = expectedHooks.filter((h) => !existsSync(join(hooksDir, h)));
if (missingHooks.length === 0) {
  pass("hook scripts", `all ${expectedHooks.length} compiled`);
} else {
  warn("hook scripts", `not built yet: ${missingHooks.join(", ")} — run 'pnpm --dir hooks build'`);
}

// 6 — MCP move-lsp build
const mcpBundle = join(ROOT, "mcp", "move-lsp-mcp", "dist", "index.js");
if (!existsSync(mcpBundle)) {
  warn("move-lsp MCP", `${mcpBundle} missing — run 'pnpm --dir mcp/move-lsp-mcp build'`);
} else {
  const size = statSync(mcpBundle).size;
  pass("move-lsp MCP", `bundle present (${size} bytes)`);
}

// ---------- Output ----------

const symbols: Record<CheckResult["status"], string> = {
  pass: "✓",
  fail: "✗",
  warn: "!",
  skip: "·",
};

console.log("");
console.log("sui-pilot doctor");
console.log("================");
for (const r of results) {
  console.log(`  ${symbols[r.status]} ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
}
console.log("");

const failed = results.filter((r) => r.status === "fail").length;
const warned = results.filter((r) => r.status === "warn").length;
if (failed > 0) {
  console.log(`✗ ${failed} check(s) failed${warned ? `, ${warned} warning(s)` : ""}`);
  process.exit(1);
}
if (warned > 0) {
  console.log(`! ${warned} warning(s) — install/build artifacts may be missing`);
  process.exit(0);
}
console.log("✓ all checks passed");
process.exit(0);
