#!/usr/bin/env node
/**
 * Build-time script that generates a static skill manifest from SKILL.md
 * frontmatter. The PreToolUse and UserPromptSubmit hooks read this manifest
 * instead of scanning and parsing every SKILL.md on each invocation.
 *
 * Usage:  node scripts/build-manifest.ts   (after `pnpm --dir hooks build`)
 *         bun run scripts/build-manifest.ts
 *
 * Reads:   skills/{slug}/SKILL.md frontmatter (via hooks/skill-map-frontmatter.mjs)
 * Writes:  generated/skill-manifest.json
 */

import { resolve, join, dirname } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { globToRegex, importPatternToRegex } from "../hooks/patterns.mjs";
import type { SkillEntry, ManifestSkill } from "../hooks/patterns.mjs";
import { buildSkillMap } from "../hooks/skill-map-frontmatter.mjs";
import type { ChainToRule, ValidationRule } from "../hooks/skill-map-frontmatter.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "skills");
const OUT_DIR = join(ROOT, "generated");
const OUT_FILE = join(OUT_DIR, "skill-manifest.json");

interface ManifestSkillWithBody extends ManifestSkill {
  bodyPath: string;
}

interface Manifest {
  generatedAt: string;
  version: 2;
  skills: Record<string, ManifestSkillWithBody>;
}

/**
 * Compile regex sources for a skill config at build time.
 * Path globs → globToRegex().source, bash patterns → RegExp source,
 * import patterns → importPatternToRegex() source+flags.
 *
 * Returns paired arrays: patterns and regex sources stay in sync so that
 * index N of pathPatterns always corresponds to index N of pathRegexSources.
 * Invalid patterns are dropped from both arrays to prevent index drift.
 */
function compileRegexSources(config: SkillEntry) {
  const pathPatterns: string[] = [];
  const pathRegexSources: string[] = [];
  for (const p of config.pathPatterns) {
    try {
      pathRegexSources.push(globToRegex(p).source);
      pathPatterns.push(p);
    } catch {
      // skip invalid
    }
  }

  const bashPatterns: string[] = [];
  const bashRegexSources: string[] = [];
  for (const p of config.bashPatterns) {
    try {
      new RegExp(p);
      bashRegexSources.push(p);
      bashPatterns.push(p);
    } catch {
      // skip invalid
    }
  }

  const importPatterns: string[] = [];
  const importRegexSources: Array<{ source: string; flags: string }> = [];
  for (const p of config.importPatterns) {
    try {
      const re = importPatternToRegex(p);
      importRegexSources.push({ source: re.source, flags: re.flags });
      importPatterns.push(p);
    } catch {
      // skip invalid
    }
  }

  return { pathPatterns, pathRegexSources, bashPatterns, bashRegexSources, importPatterns, importRegexSources };
}

/**
 * Auto-synthesize chainTo entries from validate rules that have upgradeToSkill
 * with severity "error" or "recommended", unless a matching chainTo already
 * exists for that targetSkill.
 */
function synthesizeChainToFromValidate(
  skills: Record<string, SkillEntry>,
  allSlugs: Set<string>,
): { count: number; warnings: string[] } {
  let count = 0;
  const warnings: string[] = [];

  for (const [slug, config] of Object.entries(skills)) {
    if (!config.validate?.length) continue;

    const existingTargets = new Set(
      (config.chainTo ?? []).map((c: ChainToRule) => c.targetSkill),
    );

    for (const rule of config.validate as ValidationRule[]) {
      if (!rule.upgradeToSkill) continue;
      if (rule.severity !== "error" && rule.severity !== "recommended") continue;
      if (existingTargets.has(rule.upgradeToSkill)) continue;
      if (!allSlugs.has(rule.upgradeToSkill)) {
        warnings.push(
          `skill "${slug}": cannot synthesize chainTo for upgradeToSkill "${rule.upgradeToSkill}" — target skill does not exist`,
        );
        continue;
      }

      const message =
        rule.upgradeWhy ||
        `${rule.message} — loading ${rule.upgradeToSkill} guidance.`;

      const synthesized: ChainToRule = {
        pattern: rule.pattern,
        targetSkill: rule.upgradeToSkill,
        message,
        synthesized: true,
      };

      if (!config.chainTo) {
        config.chainTo = [];
      }
      config.chainTo.push(synthesized);
      existingTargets.add(rule.upgradeToSkill);
      count++;
    }
  }

  return { count, warnings };
}

export function buildManifest(skillsDir: string): { manifest: Manifest; warnings: string[]; errors: string[] } {
  const built = buildSkillMap(skillsDir);
  const warnings: string[] = built.diagnostics.map((d) => `${d.file}: ${d.message}`);
  const errors: string[] = [];

  if (!built.skills || Object.keys(built.skills).length === 0) {
    errors.push("No valid skills found");
    return { manifest: null as unknown as Manifest, warnings, errors };
  }

  const normalizedSkills = built.skills as Record<string, SkillEntry>;
  const allSlugs = new Set(Object.keys(normalizedSkills));
  const { count: synthCount, warnings: synthWarnings } =
    synthesizeChainToFromValidate(normalizedSkills, allSlugs);
  warnings.push(...synthWarnings);
  if (synthCount > 0) {
    console.error(`  ⤳ Synthesized ${synthCount} chainTo rule(s) from upgradeToSkill validate rules`);
  }

  const skills: Record<string, ManifestSkillWithBody> = {};
  for (const [slug, config] of Object.entries(normalizedSkills) as [string, SkillEntry][]) {
    const { pathPatterns, pathRegexSources, bashPatterns, bashRegexSources, importPatterns, importRegexSources } =
      compileRegexSources(config);
    skills[slug] = {
      priority: config.priority,
      summary: config.summary,
      docs: config.docs,
      ...(config.sitemap ? { sitemap: config.sitemap } : {}),
      pathPatterns,
      bashPatterns,
      importPatterns,
      bodyPath: `skills/${slug}/SKILL.md`,
      pathRegexSources,
      bashRegexSources,
      importRegexSources,
      ...(config.validate?.length ? { validate: config.validate } : {}),
      ...(config.chainTo?.length ? { chainTo: config.chainTo } : {}),
      ...(config.promptSignals ? { promptSignals: config.promptSignals } : {}),
      ...(config.retrieval ? { retrieval: config.retrieval } : {}),
    };
  }

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    version: 2,
    skills,
  };

  return { manifest, warnings, errors };
}

export function writeManifestFile(manifest: Manifest, outDir = OUT_DIR, outFile = OUT_FILE): number {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(manifest, null, 2) + "\n");
  return Object.keys(manifest.skills).length;
}

function isMain() {
  try {
    return resolve(process.argv[1] || "") === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const { manifest, warnings, errors } = buildManifest(SKILLS_DIR);

  for (const w of warnings) console.warn(`[warn] ${w}`);

  if (errors.length > 0) {
    console.error("[error] Skill map validation failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const count = writeManifestFile(manifest);
  console.log(`✓ Wrote ${count} skills to ${OUT_FILE}`);
}

export { synthesizeChainToFromValidate };
