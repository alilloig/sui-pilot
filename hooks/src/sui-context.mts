import { join } from "node:path";
import {
  pluginRoot as resolvePluginRoot,
  safeReadFile,
  syncSessionFileFromClaims,
  tryClaimSessionKey,
} from "./hook-env.mjs";

const PLUGIN_ROOT = resolvePluginRoot();
// sui.md sections run larger than vercel.md sections (Move type system & abilities,
// Sui object model, Authorization patterns each ~3.5–4.3 KB). Set the budget so the
// most-used skills' chunks actually fit; PreToolUse's 18 KB injection budget still
// constrains the total injection.
const DEFAULT_CONTEXT_CHUNK_BUDGET_BYTES = 5_000;
const CONTEXT_CHUNK_KIND = "seen-context-chunks";

interface ChunkSectionMapping {
  chunkId: string;
  heading: string;
}

export interface ManagedContextChunk {
  chunkId: string;
  heading: string;
  skill: string;
  content: string;
  wrapped: string;
  bytes: number;
}

interface ManagedContextChunkOptions {
  pluginRoot?: string;
  sessionId?: string | null;
  budgetBytes?: number;
}

const SKILL_TO_CHUNK: Record<string, ChunkSectionMapping> = {
  "move-code-quality": { chunkId: "move-type-system", heading: "Move type system & abilities" },
  "move-code-review": { chunkId: "sui-object-model", heading: "Sui object model" },
  "move-pr-review": { chunkId: "transactions", heading: "Transactions & lifecycle" },
  "move-tests": { chunkId: "tooling", heading: "Tooling" },
  "oz-math": { chunkId: "onchain-finance", heading: "Onchain finance & math" },
};

function extractDirectSection(markdown: string, headingText: string): string {
  const specText = headingText.trim().toLowerCase();
  const lines = markdown.split("\n");
  let startLine = -1;
  let headingLevel = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (!headingMatch) continue;

    const lineLevel = headingMatch[1].length;
    const lineText = headingMatch[2].trim().toLowerCase();
    if (lineText === specText) {
      startLine = i;
      headingLevel = lineLevel;
      break;
    }
  }

  if (startLine === -1) return "";

  const contentLines: string[] = [];
  for (let i = startLine + 1; i < lines.length; i += 1) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[1].length <= headingLevel) {
      break;
    }
    contentLines.push(lines[i]);
  }

  return contentLines.join("\n").trim();
}

export function getManagedContextChunkForSkill(
  skill: string,
  options?: ManagedContextChunkOptions,
): ManagedContextChunk | null {
  const mapping = SKILL_TO_CHUNK[skill];
  if (!mapping) return null;

  const root = options?.pluginRoot ?? PLUGIN_ROOT;
  const raw = safeReadFile(join(root, "sui.md"));
  if (raw === null) return null;

  const content = extractDirectSection(raw, mapping.heading);
  if (!content) return null;

  const wrapped = `<!-- sui-context-chunk:${mapping.chunkId} -->\n${content}\n<!-- /sui-context-chunk:${mapping.chunkId} -->`;
  const bytes = Buffer.byteLength(wrapped, "utf8");
  const budget = options?.budgetBytes ?? DEFAULT_CONTEXT_CHUNK_BUDGET_BYTES;
  if (bytes > budget) return null;

  return {
    chunkId: mapping.chunkId,
    heading: mapping.heading,
    skill,
    content,
    wrapped,
    bytes,
  };
}

export function claimManagedContextChunk(
  chunkId: string,
  sessionId?: string | null,
): boolean {
  if (!sessionId) return true;
  const claimed = tryClaimSessionKey(sessionId, CONTEXT_CHUNK_KIND, chunkId);
  if (claimed) {
    syncSessionFileFromClaims(sessionId, CONTEXT_CHUNK_KIND);
  }
  return claimed;
}

export function selectManagedContextChunk(
  orderedSkills: string[],
  options?: ManagedContextChunkOptions,
): ManagedContextChunk | null {
  if (orderedSkills.length === 0) return null;

  const topSkill = orderedSkills[0];
  const chunk = getManagedContextChunkForSkill(topSkill, options);
  if (!chunk) return null;

  return claimManagedContextChunk(chunk.chunkId, options?.sessionId) ? chunk : null;
}

export { DEFAULT_CONTEXT_CHUNK_BUDGET_BYTES };
