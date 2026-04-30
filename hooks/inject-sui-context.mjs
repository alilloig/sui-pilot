#!/usr/bin/env node

// src/inject-sui-context.mts
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { pluginRoot, safeReadFile } from "./hook-env.mjs";
import { hasSessionStartActivationMarkers, isGreenfieldDirectory } from "./session-start-activation.mjs";
var GREENFIELD_CONTEXT = `<!-- sui-pilot:greenfield-execution -->
## Greenfield execution mode

This directory is empty.
Do not stop in planning mode or spin up a read-only planning subagent.
Choose sensible defaults immediately.
Start executing with real tool calls \u2014 \`sui move new\`, \`pnpm create\`, etc.
Use non-interactive scaffolding commands (--yes) where available.
Only ask follow-up questions when blocked by missing credentials or irreversible decisions.`;
function parseInjectSuiContextInput(raw) {
  try {
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function buildInjectSuiContextParts(content, env = process.env, greenfield = env.SUI_PILOT_GREENFIELD === "true") {
  const parts = [];
  if (content !== null) {
    parts.push(content);
  }
  if (greenfield) {
    parts.push(GREENFIELD_CONTEXT);
  }
  return parts;
}
function resolveProjectRoot(env = process.env) {
  return env.CLAUDE_PROJECT_ROOT ?? process.cwd();
}
function main() {
  parseInjectSuiContextInput(readFileSync(0, "utf8"));
  const projectRoot = resolveProjectRoot();
  const isGreenfield = isGreenfieldDirectory(projectRoot);
  const greenfieldOverride = process.env.SUI_PILOT_GREENFIELD === "true";
  const shouldActivate = isGreenfield || greenfieldOverride || !existsSync(projectRoot) || hasSessionStartActivationMarkers(projectRoot);
  if (!shouldActivate) return;
  const thinSessionContext = safeReadFile(join(pluginRoot(), "sui-session.md"));
  const parts = buildInjectSuiContextParts(
    thinSessionContext,
    process.env,
    isGreenfield || greenfieldOverride
  );
  if (parts.length === 0) return;
  process.stdout.write(parts.join("\n\n"));
}
var INJECT_SUI_CONTEXT_ENTRYPOINT = fileURLToPath(import.meta.url);
var isInjectSuiContextEntrypoint = process.argv[1] ? resolve(process.argv[1]) === INJECT_SUI_CONTEXT_ENTRYPOINT : false;
if (isInjectSuiContextEntrypoint) {
  main();
}
export {
  buildInjectSuiContextParts,
  parseInjectSuiContextInput
};
