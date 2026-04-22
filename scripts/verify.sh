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

if [ -f "$PLUGIN_ROOT/mcp/move-lsp-mcp/dist/index.js" ]; then
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
[ -d "$PLUGIN_ROOT/.sui-docs" ] && pass ".sui-docs exists ($(ls -1 "$PLUGIN_ROOT/.sui-docs" | wc -l | tr -d ' ') files)" || warn ".sui-docs missing"
[ -d "$PLUGIN_ROOT/.walrus-docs" ] && pass ".walrus-docs exists ($(ls -1 "$PLUGIN_ROOT/.walrus-docs" | wc -l | tr -d ' ') files)" || warn ".walrus-docs missing"
[ -d "$PLUGIN_ROOT/.seal-docs" ] && pass ".seal-docs exists ($(ls -1 "$PLUGIN_ROOT/.seal-docs" | wc -l | tr -d ' ') files)" || warn ".seal-docs missing"
[ -f "$PLUGIN_ROOT/AGENTS.md" ] && pass "AGENTS.md exists" || warn "AGENTS.md missing"

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
