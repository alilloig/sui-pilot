#!/usr/bin/env bash
# generate-docs-index.sh — Regenerate the doc index inside agents/sui-pilot-agent.md
#
# Usage: ./generate-docs-index.sh
#
# Walks .sui-docs/, .move-book-docs/, .walrus-docs/, .seal-docs/, .ts-sdk-docs/
# and produces a pipe-delimited index that AI agents parse to discover docs.
# .move-book-docs/packages/ is intentionally excluded from the index — it holds
# .move source examples referenced from the prose, available for follow-up reads
# but not surfaced as searchable docs.
# Rewrites only the block between <!-- AGENTS-MD-START --> and <!-- AGENTS-MD-END -->
# in the target file, preserving YAML frontmatter and the rest of the prompt body.

set -euo pipefail

# Force ASCII collation so `sort` produces byte-identical output across
# macOS (BSD sort) and Ubuntu CI (GNU sort). Without this, underscores
# and punctuation collate differently and the CI drift-gate fails.
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="agents/sui-pilot-agent.md"
START_MARKER="<!-- AGENTS-MD-START -->"
END_MARKER="<!-- AGENTS-MD-END -->"

if [[ ! -f "$TARGET" ]]; then
    echo "Error: $TARGET not found" >&2
    exit 1
fi

if ! grep -qF "$START_MARKER" "$TARGET" || ! grep -qF "$END_MARKER" "$TARGET"; then
    echo "Error: $TARGET is missing index markers ($START_MARKER / $END_MARKER)" >&2
    exit 1
fi

# Generate pipe-delimited directory index for a doc tree
# Format: dir:{file1.mdx,file2.mdx}|subdir:{file1.mdx,...}
# Optional second arg: a top-level subdirectory (relative to root_dir) to skip
# entirely. Used to exclude .move-book-docs/packages/ from the index.
generate_index() {
    local root_dir="$1"
    local skip_subdir="${2:-}"

    local skip_args=()
    if [[ -n "$skip_subdir" ]]; then
        skip_args=(-not -path "$root_dir/$skip_subdir/*")
    fi

    local dirs=()
    while IFS= read -r d; do
        dirs+=("$d")
    done < <(find "$root_dir" -type f \( -name '*.mdx' -o -name '*.md' \) ${skip_args[@]+"${skip_args[@]}"} -exec dirname {} \; | sort -u)

    local parts=()
    for d in "${dirs[@]}"; do
        local rel
        if [[ "$d" == "$root_dir" ]]; then
            rel="."
        else
            rel="${d#$root_dir/}"
        fi

        local files=()
        while IFS= read -r f; do
            files+=("$(basename "$f")")
        done < <(find "$d" -maxdepth 1 -type f \( -name '*.mdx' -o -name '*.md' \) ${skip_args[@]+"${skip_args[@]}"} | sort)

        if [[ ${#files[@]} -gt 0 ]]; then
            local file_list
            file_list=$(IFS=,; echo "${files[*]}")
            parts+=("${rel}:{${file_list}}")
        fi
    done

    local result
    result=$(IFS='|'; echo "${parts[*]}")
    echo "$result"
}

echo "Generating doc index into $TARGET..."

sui_count=$(find .sui-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' ')
move_book_count=$(find .move-book-docs -type f \( -name '*.mdx' -o -name '*.md' \) -not -path '.move-book-docs/packages/*' 2>/dev/null | wc -l | tr -d ' ')
walrus_count=$(find .walrus-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' ')
seal_count=$(find .seal-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' ')
ts_sdk_count=$(find .ts-sdk-docs -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' ')

echo "  Sui:       $sui_count files"
echo "  Move Book: $move_book_count files (indexed; excludes packages/)"
echo "  Walrus:    $walrus_count files"
echo "  Seal:      $seal_count files"
echo "  TS SDK:    $ts_sdk_count files"

echo "  Building Sui index..."
sui_index=$(generate_index ".sui-docs")

echo "  Building Move Book index..."
move_book_index=$(generate_index ".move-book-docs" "packages")

echo "  Building Walrus index..."
walrus_index=$(generate_index ".walrus-docs")

echo "  Building Seal index..."
seal_index=$(generate_index ".seal-docs")

echo "  Building TS SDK index..."
ts_sdk_index=$(generate_index ".ts-sdk-docs")

BLOCK_FILE=$(mktemp -t sui-pilot-index.XXXXXX)
trap 'rm -f "$BLOCK_FILE" "${TMP_TARGET:-}"' EXIT

{
    printf '%s' "$START_MARKER"
    printf '[Sui Docs Index]|root: ./.sui-docs|STOP. What you remember about Sui and Move is WRONG or OUTDATED for this project. Sui Move evolves rapidly. Always search these docs and read before any task.|If docs are stale, run ./sync-docs.sh to update from upstream.|%s' "$sui_index"
    printf '\n\n'
    printf '[Move Book Docs Index]|root: ./.move-book-docs|The canonical Move language tutorial (book/) and reference (reference/) by MystenLabs, with Sui-specific framing throughout. Search these docs for Move syntax, types, abilities, modules, generics, testing, and Move-2024 idioms.|%s' "$move_book_index"
    printf '\n\n'
    printf '[Seal Docs Index]|root: ./.seal-docs|Seal is a decentralized secrets management protocol built on Sui. Search these docs for encryption, access control policies, key servers, and threshold cryptography on Sui.|%s' "$seal_index"
    printf '\n\n'
    printf '[Walrus Docs Index]|root: ./.walrus-docs|Walrus is a decentralized storage protocol built on Sui. Search these docs for blob storage, Walrus Sites, TypeScript SDK, HTTP API, and node operations.|%s' "$walrus_index"
    printf '\n\n'
    printf '[TS SDK Docs Index]|root: ./.ts-sdk-docs|TypeScript SDK documentation for Sui. Search these docs for dapp-kit, payment-kit, kiosk SDK, transactions, clients, React hooks, and frontend integration.|%s' "$ts_sdk_index"
    printf '\n%s' "$END_MARKER"
} > "$BLOCK_FILE"

# Guard: refuse to write an empty replacement block. Would otherwise wipe
# the index from the agent file silently.
for section in '[Sui Docs Index]' '[Move Book Docs Index]' '[Walrus Docs Index]' '[Seal Docs Index]' '[TS SDK Docs Index]'; do
    if ! grep -qF "$section" "$BLOCK_FILE"; then
        echo "Error: generated block is missing $section — aborting to avoid wiping $TARGET" >&2
        exit 1
    fi
done

TMP_TARGET=$(mktemp -t sui-pilot-agent.XXXXXX)
awk -v start="$START_MARKER" -v end="$END_MARKER" -v block_file="$BLOCK_FILE" '
    BEGIN {
        while ((getline line < block_file) > 0) {
            replacement = replacement (replacement == "" ? "" : "\n") line
        }
        close(block_file)
        inside = 0
    }
    {
        if (!inside && index($0, start) > 0) {
            print replacement
            if (index($0, end) > 0) {
                next
            }
            inside = 1
            next
        }
        if (inside) {
            if (index($0, end) > 0) {
                inside = 0
            }
            next
        }
        print
    }
' "$TARGET" > "$TMP_TARGET"

mv "$TMP_TARGET" "$TARGET"

block_size=$(wc -c < "$BLOCK_FILE" | tr -d ' ')
echo ""
echo "Rewrote index block in $TARGET (${block_size} bytes between markers)"
echo "  Sui:       $sui_count files indexed"
echo "  Move Book: $move_book_count files indexed (excludes packages/)"
echo "  Walrus:    $walrus_count files indexed"
echo "  Seal:      $seal_count files indexed"
echo "  TS SDK:    $ts_sdk_count files indexed"
