#!/bin/bash
set -euo pipefail

# Sync sui-pilot documentation to plugin docs directory
# Usage: ./sync-sui-pilot-docs.sh [source_path]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
DOCS_DIR="$PLUGIN_ROOT/docs"

# Default to workspace root, or use provided path
SUI_PILOT_SOURCE="${1:-$(dirname $(dirname "$PLUGIN_ROOT"))}"

echo "Syncing sui-pilot docs from: $SUI_PILOT_SOURCE"
echo "Target directory: $DOCS_DIR"

# Verify source files exist
required_files=(
    "CLAUDE.md"
    "AGENTS.md"
    ".sui-docs"
    ".walrus-docs"
    ".seal-docs"
)

for file in "${required_files[@]}"; do
    if [[ ! -e "$SUI_PILOT_SOURCE/$file" ]]; then
        echo "Error: Required file/directory not found: $SUI_PILOT_SOURCE/$file"
        exit 1
    fi
done

# Create docs directory if it doesn't exist
mkdir -p "$DOCS_DIR"

# Copy documentation files
echo "Copying documentation files..."
cp -r "$SUI_PILOT_SOURCE/CLAUDE.md" "$DOCS_DIR/"
cp -r "$SUI_PILOT_SOURCE/AGENTS.md" "$DOCS_DIR/"
cp -r "$SUI_PILOT_SOURCE/.sui-docs" "$DOCS_DIR/"
cp -r "$SUI_PILOT_SOURCE/.walrus-docs" "$DOCS_DIR/"
cp -r "$SUI_PILOT_SOURCE/.seal-docs" "$DOCS_DIR/"

# Update VERSION.json with current sync info
cd "$SUI_PILOT_SOURCE"
if [[ -d ".git" ]]; then
    COMMIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
else
    COMMIT_SHA="unknown"
fi

SYNC_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

cat > "$DOCS_DIR/VERSION.json" << EOF
{
  "sourceCommit": "$COMMIT_SHA",
  "syncTimestamp": "$SYNC_TIMESTAMP",
  "suiFrameworkVersion": "1.0.0+"
}
EOF

echo "Documentation sync complete!"
echo "Source commit: $COMMIT_SHA"
echo "Sync timestamp: $SYNC_TIMESTAMP"