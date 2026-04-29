#!/usr/bin/env node
/**
 * SessionStart hook: inject a thin Sui-pilot session context.
 * Claude-Code-only: emits plain text to stdout.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginRoot, safeReadFile } from "./hook-env.mjs";
import { hasSessionStartActivationMarkers, isGreenfieldDirectory } from "./session-start-activation.mjs";

interface InjectSuiContextInput {
  session_id?: string;
  [key: string]: unknown;
}

const GREENFIELD_CONTEXT = `<!-- sui-pilot:greenfield-execution -->
## Greenfield execution mode

This directory is empty.
Do not stop in planning mode or spin up a read-only planning subagent.
Choose sensible defaults immediately.
Start executing with real tool calls — \`sui move new\`, \`pnpm create\`, etc.
Use non-interactive scaffolding commands (--yes) where available.
Only ask follow-up questions when blocked by missing credentials or irreversible decisions.`;

export function parseInjectSuiContextInput(raw: string): InjectSuiContextInput | null {
  try {
    if (!raw.trim()) return null;
    return JSON.parse(raw) as InjectSuiContextInput;
  } catch {
    return null;
  }
}

export function buildInjectSuiContextParts(
  content: string | null,
  env: NodeJS.ProcessEnv = process.env,
  greenfield = env.SUI_PILOT_GREENFIELD === "true",
): string[] {
  const parts: string[] = [];

  if (content !== null) {
    parts.push(content);
  }

  if (greenfield) {
    parts.push(GREENFIELD_CONTEXT);
  }

  return parts;
}

function resolveProjectRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_PROJECT_ROOT ?? process.cwd();
}

function main(): void {
  parseInjectSuiContextInput(readFileSync(0, "utf8"));
  const projectRoot = resolveProjectRoot();
  const isGreenfield = isGreenfieldDirectory(projectRoot);
  const greenfieldOverride = process.env.SUI_PILOT_GREENFIELD === "true";
  const shouldActivate =
    isGreenfield ||
    greenfieldOverride ||
    !existsSync(projectRoot) ||
    hasSessionStartActivationMarkers(projectRoot);
  if (!shouldActivate) return;

  const thinSessionContext = safeReadFile(join(pluginRoot(), "sui-session.md"));
  const parts = buildInjectSuiContextParts(
    thinSessionContext,
    process.env,
    isGreenfield || greenfieldOverride,
  );

  if (parts.length === 0) return;

  process.stdout.write(parts.join("\n\n"));
}

const INJECT_SUI_CONTEXT_ENTRYPOINT = fileURLToPath(import.meta.url);
const isInjectSuiContextEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === INJECT_SUI_CONTEXT_ENTRYPOINT
  : false;

if (isInjectSuiContextEntrypoint) {
  main();
}
