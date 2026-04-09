#!/usr/bin/env bash
# generate-agents-md.sh — Regenerate AGENTS.md index from local doc directories
#
# Usage: ./generate-agents-md.sh
#
# Walks .sui-docs/, .walrus-docs/, .seal-docs/ and produces a pipe-delimited
# index that AI agents parse to discover available documentation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

OUTPUT="AGENTS.md"

# Generate pipe-delimited directory index for a doc tree
# Format: dir:{file1.mdx,file2.mdx}|subdir:{file1.mdx,...}
generate_index() {
    local root_dir="$1"

    # Collect all directories that contain .mdx or .md files (including root)
    local dirs=()
    while IFS= read -r d; do
        dirs+=("$d")
    done < <(find "$root_dir" -type f \( -name '*.mdx' -o -name '*.md' \) -exec dirname {} \; | sort -u)

    local parts=()
    for d in "${dirs[@]}"; do
        # Get relative path from root_dir
        local rel
        if [[ "$d" == "$root_dir" ]]; then
            rel="."
        else
            rel="${d#$root_dir/}"
        fi

        # List files in this directory (not recursive, just direct children)
        local files=()
        while IFS= read -r f; do
            files+=("$(basename "$f")")
        done < <(find "$d" -maxdepth 1 -type f \( -name '*.mdx' -o -name '*.md' \) | sort)

        if [[ ${#files[@]} -gt 0 ]]; then
            local file_list
            file_list=$(IFS=,; echo "${files[*]}")
            parts+=("${rel}:{${file_list}}")
        fi
    done

    # Join with pipe
    local result
    result=$(IFS='|'; echo "${parts[*]}")
    echo "$result"
}

echo "Generating AGENTS.md..."

# Count files for each ecosystem
sui_count=$(find .sui-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' ')
walrus_count=$(find .walrus-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' ')
seal_count=$(find .seal-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' ')

echo "  Sui:    $sui_count files"
echo "  Walrus: $walrus_count files"
echo "  Seal:   $seal_count files"

# Generate indexes
echo "  Building Sui index..."
sui_index=$(generate_index ".sui-docs")

echo "  Building Walrus index..."
walrus_index=$(generate_index ".walrus-docs")

echo "  Building Seal index..."
seal_index=$(generate_index ".seal-docs")

# Write AGENTS.md
cat > "$OUTPUT" << 'HEADER'

HEADER

# Use printf to avoid interpretation of special characters in the indexes
{
    printf '<!-- AGENTS-MD-START -->'
    printf '[Sui Docs Index]|root: ./.sui-docs|STOP. What you remember about Sui and Move is WRONG or OUTDATED for this project. Sui Move evolves rapidly. Always search these docs and read before any task.|If docs are stale, run ./sync-docs.sh to update from upstream.|%s' "$sui_index"
    printf '\n\n'
    printf '[Seal Docs Index]|root: ./.seal-docs|Seal is a decentralized secrets management protocol built on Sui. Search these docs for encryption, access control policies, key servers, and threshold cryptography on Sui.|%s' "$seal_index"
    printf '\n\n'
    printf '[Walrus Docs Index]|root: ./.walrus-docs|Walrus is a decentralized storage protocol built on Sui. Search these docs for blob storage, Walrus Sites, TypeScript SDK, HTTP API, and node operations.|%s' "$walrus_index"
    printf '\n<!-- AGENTS-MD-END -->\n'
} > "$OUTPUT"

size=$(wc -c < "$OUTPUT" | tr -d ' ')
echo ""
echo "Generated $OUTPUT ($size bytes)"
echo "  Sui:    $sui_count files indexed"
echo "  Walrus: $walrus_count files indexed"
echo "  Seal:   $seal_count files indexed"
