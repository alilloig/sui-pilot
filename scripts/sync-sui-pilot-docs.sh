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
    "agents/sui-pilot-agent.md"
    ".sui-docs"
    ".move-book-docs"
    ".walrus-docs"
    ".seal-docs"
    ".ts-sdk-docs"
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
mkdir -p "$DOCS_DIR/agents"
cp -r "$SUI_PILOT_SOURCE/agents/sui-pilot-agent.md" "$DOCS_DIR/agents/"
cp -r "$SUI_PILOT_SOURCE/.sui-docs" "$DOCS_DIR/"
cp -r "$SUI_PILOT_SOURCE/.move-book-docs" "$DOCS_DIR/"
cp -r "$SUI_PILOT_SOURCE/.walrus-docs" "$DOCS_DIR/"
cp -r "$SUI_PILOT_SOURCE/.seal-docs" "$DOCS_DIR/"
cp -r "$SUI_PILOT_SOURCE/.ts-sdk-docs" "$DOCS_DIR/"

# Update VERSION.json with current sync info.
# Schema consumed by mcp/move-lsp-mcp/src/version.ts — keep {pluginVersion,
# suiPilotRevision, syncTimestamp} in sync with that interface.
cd "$SUI_PILOT_SOURCE"
if [[ -d ".git" || -f ".git" ]]; then
    COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
else
    COMMIT_SHA="unknown"
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required to extract sui-pilot plugin version from .claude-plugin/marketplace.json" >&2
    exit 1
fi
PLUGIN_VERSION=$(
    jq -r '.plugins[] | select(.name == "sui-pilot") | .version' \
        "$SUI_PILOT_SOURCE/.claude-plugin/marketplace.json" 2>/dev/null
)
if [[ -z "$PLUGIN_VERSION" || "$PLUGIN_VERSION" == "null" ]]; then
    echo "Error: could not read sui-pilot plugin version from .claude-plugin/marketplace.json" >&2
    echo "       mcp/move-lsp-mcp/src/version.ts requires a valid pluginVersion in docs/VERSION.json." >&2
    exit 1
fi

SYNC_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$DOCS_DIR/VERSION.json" << EOF
{
  "pluginVersion": "$PLUGIN_VERSION",
  "suiPilotRevision": "$COMMIT_SHA",
  "syncTimestamp": "$SYNC_TIMESTAMP"
}
EOF

echo "Documentation sync complete!"
echo "Plugin version:  $PLUGIN_VERSION"
echo "Source commit:   $COMMIT_SHA"
echo "Sync timestamp:  $SYNC_TIMESTAMP"
