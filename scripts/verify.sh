#!/usr/bin/env bash
#
# sui-pilot verification script
# Checks that all components are properly installed and working
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAILED=true; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

FAILED=false

echo ""
echo "========================================"
echo "  sui-pilot Verification"
echo "========================================"
echo ""

# Check plugin structure
echo "Checking plugin structure..."
[ -f "$PLUGIN_ROOT/.claude-plugin/plugin.json" ] && pass "plugin.json exists" || fail "plugin.json missing"
[ -f "$PLUGIN_ROOT/.claude-plugin/marketplace.json" ] && pass "marketplace.json exists" || fail "marketplace.json missing"
[ -f "$PLUGIN_ROOT/agents/sui-pilot-agent.md" ] && pass "agent exists" || fail "agent missing"
[ -d "$PLUGIN_ROOT/skills" ] && pass "skills directory exists" || fail "skills directory missing"

# Check MCP server
echo ""
echo "Checking MCP server..."
[ -f "$PLUGIN_ROOT/mcp/move-lsp-mcp/dist/index.js" ] && pass "MCP server built" || fail "MCP server not built"

# Same budget enforced by .github/workflows/ci.yml — keep in sync.
BUDGET_BYTES=600000
if [ -f "$PLUGIN_ROOT/mcp/move-lsp-mcp/dist/index.js" ]; then
    SIZE=$(wc -c < "$PLUGIN_ROOT/mcp/move-lsp-mcp/dist/index.js" | tr -d ' ')
    if [ "$SIZE" -le "$BUDGET_BYTES" ]; then
        pass "MCP bundle within budget ($SIZE / $BUDGET_BYTES bytes)"
    else
        fail "MCP bundle exceeds budget ($SIZE / $BUDGET_BYTES bytes)"
    fi

    cd "$PLUGIN_ROOT/mcp/move-lsp-mcp"
    if pnpm test 2>&1 | grep -q "passed"; then
        pass "MCP tests pass"
    else
        fail "MCP tests failed"
    fi
fi

# Check documentation
echo ""
echo "Checking documentation..."
count_doc_files() {
    find "$1" -type f \( -name '*.mdx' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' '
}

for dir in .sui-docs .walrus-docs .seal-docs .ts-sdk-docs; do
    if [ -d "$PLUGIN_ROOT/$dir" ]; then
        pass "$dir exists ($(count_doc_files "$PLUGIN_ROOT/$dir") doc files)"
    else
        warn "$dir missing"
    fi
done

AGENT_FILE="$PLUGIN_ROOT/agents/sui-pilot-agent.md"
if [ -f "$AGENT_FILE" ] \
    && grep -qF "<!-- AGENTS-MD-START -->" "$AGENT_FILE" \
    && grep -qF "<!-- AGENTS-MD-END -->" "$AGENT_FILE" \
    && grep -qF "[Sui Docs Index]" "$AGENT_FILE" \
    && grep -qF "[Walrus Docs Index]" "$AGENT_FILE" \
    && grep -qF "[Seal Docs Index]" "$AGENT_FILE" \
    && grep -qF "[TS SDK Docs Index]" "$AGENT_FILE"; then
    pass "agents/sui-pilot-agent.md contains the doc index for all four ecosystems"
else
    warn "agents/sui-pilot-agent.md missing doc index — run ./generate-docs-index.sh"
fi

# Check move-analyzer
echo ""
echo "Checking move-analyzer..."
if command -v move-analyzer &> /dev/null; then
    pass "move-analyzer found at $(which move-analyzer)"

    # Try to get version
    if move-analyzer --version &> /dev/null; then
        pass "move-analyzer responds to --version"
    else
        warn "move-analyzer doesn't respond to --version (might still work)"
    fi
else
    warn "move-analyzer not found - LSP features will be unavailable"
    echo "      Install: suiup install move-analyzer"
fi

# Summary
echo ""
echo "========================================"
if [ "$FAILED" = true ]; then
    echo -e "  ${RED}Verification failed${NC}"
    echo "  Some components need attention."
    exit 1
else
    echo -e "  ${GREEN}Verification passed${NC}"
    echo "  sui-pilot is ready to use."
fi
echo "========================================"
echo ""
