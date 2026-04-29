#!/usr/bin/env bash
# sync-docs.sh — Pull latest documentation from upstream MystenLabs repos
#
# Usage: ./sync-docs.sh [--dry-run]
#
# Requires: gh (GitHub CLI), tar, find
#
# Upstream sources:
#   Sui       -> MystenLabs/sui        docs/content/                   -> .sui-docs/
#   Walrus    -> MystenLabs/walrus     docs/content/                   -> .walrus-docs/
#   Seal      -> MystenLabs/seal       docs/content/                   -> .seal-docs/
#   TS SDK    -> MystenLabs/ts-sdks    packages/docs/content/          -> .ts-sdk-docs/
#   Move Book -> MystenLabs/move-book  book/, reference/, packages/    -> .move-book-docs/

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

# Like sync_repo, but extracts multiple upstream subdirectories from one
# tarball into a single local_dir, preserving each upstream subdir's name.
# Useful for repos with multiple top-level prose roots (e.g. move-book has
# both book/ and reference/, plus packages/ source examples referenced from
# the prose). Pass upstream_paths as a comma-separated list.
sync_repo_multi() {
    local owner="$1"
    local repo="$2"
    local upstream_paths="$3"  # e.g. "book,reference,packages"
    local local_dir="$4"
    local label="$5"

    echo "[$label] Downloading tarball from $owner/$repo..."
    local tarball="$TMPDIR_BASE/${repo}.tar.gz"
    gh api "repos/$owner/$repo/tarball/main" > "$tarball"

    local extract_dir="$TMPDIR_BASE/${repo}-extract"
    mkdir -p "$extract_dir"

    # Strip only the top-level "owner-repo-hash/" dir so each upstream path
    # lands as $extract_dir/<path>/...
    local IFS_SAVE="$IFS"
    IFS=','
    local includes=()
    for p in $upstream_paths; do
        echo "[$label] Extracting $p/..."
        includes+=("--include=*/${p}/*")
    done
    IFS="$IFS_SAVE"

    tar xzf "$tarball" -C "$extract_dir" --strip-components=1 \
        "${includes[@]}" 2>/dev/null || true

    # bsdtar may materialize empty top-level dirs for archive entries that
    # don't match the --include filter. Drop anything not in the expected
    # set so the local corpus contains only the requested subtrees.
    local expected_top=()
    IFS=','
    for p in $upstream_paths; do
        expected_top+=("${p%%/*}")
    done
    IFS="$IFS_SAVE"
    while IFS= read -r entry; do
        local name
        name=$(basename "$entry")
        local keep=false
        for e in "${expected_top[@]}"; do
            [[ "$name" == "$e" ]] && keep=true && break
        done
        $keep || rm -rf "$entry"
    done < <(find "$extract_dir" -mindepth 1 -maxdepth 1)

    local md_count
    md_count=$(find "$extract_dir" -type f \( -name '*.mdx' -o -name '*.md' \) | wc -l | tr -d ' ')
    echo "[$label] Extracted $md_count MDX/MD files (plus any other content from the included paths)"

    if [[ "$md_count" -eq 0 ]]; then
        echo "[$label] WARNING: No MDX/MD files extracted! Skipping to avoid data loss."
        return 1
    fi

    if $DRY_RUN; then
        echo "[$label] DRY RUN — would replace $local_dir/ with extracted content"
        return 0
    fi

    strip_binaries "$extract_dir"

    rm -rf "$local_dir"
    mv "$extract_dir" "$local_dir"
    echo "[$label] Updated $local_dir/"
}

echo "=== sui-pilot doc sync ==="
echo ""

sync_repo       "MystenLabs" "sui"       "docs/content"            ".sui-docs"       "Sui"
sync_repo       "MystenLabs" "walrus"    "docs/content"            ".walrus-docs"    "Walrus"
sync_repo       "MystenLabs" "seal"      "docs/content"            ".seal-docs"      "Seal"
sync_repo       "MystenLabs" "ts-sdks"   "packages/docs/content"   ".ts-sdk-docs"    "TS SDK"
sync_repo_multi "MystenLabs" "move-book" "book,reference,packages" ".move-book-docs" "Move Book"

echo ""
echo "=== Sync complete ==="
echo ""
echo "File counts:"
for dir in .sui-docs .walrus-docs .seal-docs .ts-sdk-docs .move-book-docs; do
    if [[ -d "$dir" ]]; then
        count=$(find "$dir" -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' ')
        echo "  $dir: $count MDX/MD files"
    else
        echo "  $dir: (not present — skipped)"
    fi
done
if [[ -d .move-book-docs ]]; then
    move_book_indexed=$(find .move-book-docs -type f \( -name '*.mdx' -o -name '*.md' \) -not -path '.move-book-docs/packages/*' 2>/dev/null | wc -l | tr -d ' ')
    echo "    (.move-book-docs indexed subset, excluding packages/: $move_book_indexed)"
fi

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
    "ts-sdks": "MystenLabs/ts-sdks@main",
    "move-book": "MystenLabs/move-book@main"
  },
  "fileCounts": {
    "sui": $(find .sui-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' '),
    "walrus": $(find .walrus-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' '),
    "seal": $(find .seal-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' '),
    "ts-sdks": $(find .ts-sdk-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' '),
    "move-book": $(find .move-book-docs -type f \( -name '*.mdx' -o -name '*.md' \) -not -path '.move-book-docs/packages/*' 2>/dev/null | wc -l | tr -d ' ')
  }
}
EOF
    echo ""
    echo "Recorded sync timestamp to .last-sync"
fi

