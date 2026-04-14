#!/usr/bin/env bash
# sync-docs.sh — Pull latest documentation from upstream MystenLabs repos
#
# Usage: ./sync-docs.sh [--dry-run]
#
# Requires: gh (GitHub CLI), tar, find
#
# Upstream sources:
#   Sui    -> MystenLabs/sui      docs/content/  -> .sui-docs/
#   Walrus -> MystenLabs/walrus   docs/content/  -> .walrus-docs/
#   Seal   -> MystenLabs/seal     docs/content/  -> .seal-docs/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

TMPDIR_BASE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_BASE"' EXIT

# Binary extensions to strip (useless for AI text consumption)
BINARY_EXTENSIONS=(png jpg jpeg gif svg excalidraw webp ico bmp tiff)

strip_binaries() {
    local dir="$1"
    for ext in "${BINARY_EXTENSIONS[@]}"; do
        find "$dir" -name "*.$ext" -delete 2>/dev/null || true
    done
    # Remove empty directories left behind
    find "$dir" -type d -empty -delete 2>/dev/null || true
}

sync_repo() {
    local owner="$1"
    local repo="$2"
    local upstream_path="$3"   # e.g. "docs/content"
    local local_dir="$4"       # e.g. ".sui-docs"
    local label="$5"           # e.g. "Sui"

    echo "[$label] Downloading tarball from $owner/$repo..."
    local tarball="$TMPDIR_BASE/${repo}.tar.gz"
    gh api "repos/$owner/$repo/tarball/main" > "$tarball"

    echo "[$label] Extracting $upstream_path/..."
    local extract_dir="$TMPDIR_BASE/${repo}-extract"
    mkdir -p "$extract_dir"

    # Tarball has a top-level dir like "owner-repo-hash/"
    # Extract only the docs/content subtree, stripping the top-level + upstream path components
    local strip_count
    strip_count=$(echo "$upstream_path" | tr '/' '\n' | wc -l | tr -d ' ')
    strip_count=$((strip_count + 1))  # +1 for the top-level "owner-repo-hash" dir

    tar xzf "$tarball" -C "$extract_dir" --strip-components="$strip_count" \
        --include="*/${upstream_path}/*" 2>/dev/null || true

    # Count extracted files
    local count
    count=$(find "$extract_dir" -type f \( -name '*.mdx' -o -name '*.md' \) | wc -l | tr -d ' ')
    echo "[$label] Extracted $count MDX/MD files"

    if [[ "$count" -eq 0 ]]; then
        echo "[$label] WARNING: No files extracted! Skipping to avoid data loss."
        return 1
    fi

    if $DRY_RUN; then
        echo "[$label] DRY RUN — would replace $local_dir/ with $count files"
        return 0
    fi

    # Strip binaries from extracted content
    strip_binaries "$extract_dir"

    local md_count
    md_count=$(find "$extract_dir" -type f \( -name '*.mdx' -o -name '*.md' -o -name '*.pdf' \) | wc -l | tr -d ' ')
    echo "[$label] After stripping binaries: $md_count text files"

    # Replace local directory
    rm -rf "$local_dir"
    mv "$extract_dir" "$local_dir"
    echo "[$label] Updated $local_dir/"
}

echo "=== sui-pilot doc sync ==="
echo ""

sync_repo "MystenLabs" "sui"     "docs/content"          ".sui-docs"     "Sui"
sync_repo "MystenLabs" "walrus"  "docs/content"          ".walrus-docs"  "Walrus"
sync_repo "MystenLabs" "seal"    "docs/content"          ".seal-docs"    "Seal"
sync_repo "MystenLabs" "ts-sdks" "packages/docs/content" ".ts-sdk-docs"  "TS SDK"

echo ""
echo "=== Sync complete ==="
echo ""
echo "File counts:"
for dir in .sui-docs .walrus-docs .seal-docs .ts-sdk-docs; do
    count=$(find "$dir" -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' ')
    echo "  $dir: $count MDX/MD files"
done

# Record sync timestamp
if ! $DRY_RUN; then
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    cat > .last-sync << EOF
{
  "syncTimestamp": "$TIMESTAMP",
  "sources": {
    "sui": "MystenLabs/sui@main",
    "walrus": "MystenLabs/walrus@main",
    "seal": "MystenLabs/seal@main",
    "ts-sdks": "MystenLabs/ts-sdks@main"
  },
  "fileCounts": {
    "sui": $(find .sui-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' '),
    "walrus": $(find .walrus-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' '),
    "seal": $(find .seal-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' '),
    "ts-sdks": $(find .ts-sdk-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' ')
  }
}
EOF
    echo ""
    echo "Recorded sync timestamp to .last-sync"
fi

echo ""
echo "Next: run ./generate-docs-index.sh to regenerate the AGENTS.md index"
