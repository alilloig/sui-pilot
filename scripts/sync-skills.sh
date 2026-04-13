#!/usr/bin/env bash
# sync-skills.sh — Copy Move skills from repo source into plugin bundle.
# Source of truth lives in skills/; this plugin bundle is a synced derivative.
# Exits non-zero on any copy failure or frontmatter parse error.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PLUGIN_ROOT}/../.." && pwd)"

SKILLS=(move-code-quality move-code-review move-tests)

# Parse the value of a frontmatter key from a SKILL.md file.
# Usage: parse_frontmatter_key <file> <key>
parse_frontmatter_key() {
  local file="$1"
  local key="$2"
  # Extract text between first and second '---' lines, then grep for the key.
  awk '/^---/{n++; if(n==2) exit; next} n==1{print}' "$file" \
    | grep -E "^${key}:" \
    | sed -E "s/^${key}:[[:space:]]*//" \
    | head -1
}

echo "==> Syncing Move skills into plugin bundle"
echo "    Source root : ${REPO_ROOT}/skills"
echo "    Plugin root : ${PLUGIN_ROOT}/skills"
echo ""

for skill in "${SKILLS[@]}"; do
  src="${REPO_ROOT}/skills/${skill}/SKILL.md"
  dst="${PLUGIN_ROOT}/skills/${skill}/SKILL.md"
  dst_dir="${PLUGIN_ROOT}/skills/${skill}"

  # Validate source exists
  if [[ ! -f "$src" ]]; then
    echo "ERROR: Source not found: ${src}" >&2
    exit 1
  fi

  # Parse and validate frontmatter (use || true for optional keys to avoid set -e)
  name_val=$(parse_frontmatter_key "$src" "name" || true)
  if [[ -z "$name_val" ]]; then
    echo "ERROR: Could not parse 'name' from frontmatter of ${src}" >&2
    exit 1
  fi
  echo "  [${skill}] name=${name_val}"

  # description may be multi-line YAML block scalar; verify the key exists
  if ! grep -qE "^description:" "$src"; then
    echo "ERROR: Missing 'description' key in frontmatter of ${src}" >&2
    exit 1
  fi

  # Check for optional version field
  version_val=$(parse_frontmatter_key "$src" "version" || true)
  if [[ -n "$version_val" ]]; then
    echo "  [${skill}] version=${version_val}"
  fi

  # Ensure destination directory exists
  mkdir -p "$dst_dir"

  # Copy (exits non-zero via set -e on failure)
  cp "$src" "$dst" || { echo "ERROR: Failed to copy ${src} -> ${dst}" >&2; exit 1; }
  echo "  [${skill}] copied OK"
done

echo ""
echo "==> Sync complete (${#SKILLS[@]} skills)"
