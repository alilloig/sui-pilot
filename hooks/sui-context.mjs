// src/sui-context.mts
import { join } from "path";
import {
  pluginRoot as resolvePluginRoot,
  safeReadFile,
  syncSessionFileFromClaims,
  tryClaimSessionKey
} from "./hook-env.mjs";
var PLUGIN_ROOT = resolvePluginRoot();
var DEFAULT_CONTEXT_CHUNK_BUDGET_BYTES = 5e3;
var CONTEXT_CHUNK_KIND = "seen-context-chunks";
var SKILL_TO_CHUNK = {
  "move-code-quality": { chunkId: "move-type-system", heading: "Move type system & abilities" },
  "move-code-review": { chunkId: "sui-object-model", heading: "Sui object model" },
  "move-pr-review": { chunkId: "transactions", heading: "Transactions & lifecycle" },
  "move-tests": { chunkId: "tooling", heading: "Tooling" },
  "oz-math": { chunkId: "onchain-finance", heading: "Onchain finance & math" }
};
function extractDirectSection(markdown, headingText) {
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
  const contentLines = [];
  for (let i = startLine + 1; i < lines.length; i += 1) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[1].length <= headingLevel) {
      break;
    }
    contentLines.push(lines[i]);
  }
  return contentLines.join("\n").trim();
}
function getManagedContextChunkForSkill(skill, options) {
  const mapping = SKILL_TO_CHUNK[skill];
  if (!mapping) return null;
  const root = options?.pluginRoot ?? PLUGIN_ROOT;
  const raw = safeReadFile(join(root, "sui.md"));
  if (raw === null) return null;
  const content = extractDirectSection(raw, mapping.heading);
  if (!content) return null;
  const wrapped = `<!-- sui-context-chunk:${mapping.chunkId} -->
${content}
<!-- /sui-context-chunk:${mapping.chunkId} -->`;
  const bytes = Buffer.byteLength(wrapped, "utf8");
  const budget = options?.budgetBytes ?? DEFAULT_CONTEXT_CHUNK_BUDGET_BYTES;
  if (bytes > budget) return null;
  return {
    chunkId: mapping.chunkId,
    heading: mapping.heading,
    skill,
    content,
    wrapped,
    bytes
  };
}
function claimManagedContextChunk(chunkId, sessionId) {
  if (!sessionId) return true;
  const claimed = tryClaimSessionKey(sessionId, CONTEXT_CHUNK_KIND, chunkId);
  if (claimed) {
    syncSessionFileFromClaims(sessionId, CONTEXT_CHUNK_KIND);
  }
  return claimed;
}
function selectManagedContextChunk(orderedSkills, options) {
  if (orderedSkills.length === 0) return null;
  const topSkill = orderedSkills[0];
  const chunk = getManagedContextChunkForSkill(topSkill, options);
  if (!chunk) return null;
  return claimManagedContextChunk(chunk.chunkId, options?.sessionId) ? chunk : null;
}
export {
  DEFAULT_CONTEXT_CHUNK_BUDGET_BYTES,
  claimManagedContextChunk,
  getManagedContextChunkForSkill,
  selectManagedContextChunk
};
