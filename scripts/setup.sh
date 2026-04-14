#!/usr/bin/env bash
#
# sui-pilot setup script
# Installs all dependencies required for the Claude Code plugin
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo "========================================"
echo "  sui-pilot Plugin Setup"
echo "========================================"
echo ""

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        log_success "Node.js $(node --version) found"
    else
        log_error "Node.js 18+ required, found $(node --version)"
        exit 1
    fi
else
    log_error "Node.js not found. Please install Node.js 18+"
    exit 1
fi

# Check pnpm
if command -v pnpm &> /dev/null; then
    log_success "pnpm $(pnpm --version) found"
else
    log_warn "pnpm not found, installing..."
    npm install -g pnpm
    log_success "pnpm installed"
fi

# Check suiup (Sui toolchain manager)
SUIUP_AVAILABLE=false
if command -v suiup &> /dev/null; then
    log_success "suiup $(suiup --version 2>/dev/null || echo 'installed') found"
    SUIUP_AVAILABLE=true
else
    log_warn "suiup not found."
    echo ""
    echo "suiup is the recommended way to install sui and move-analyzer."
    echo "Install it with:"
    echo "  curl -fsSL https://sui.io/install.sh | sh"
    echo ""
    read -p "Install suiup now? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "Installing suiup..."
        curl -fsSL https://sui.io/install.sh | sh
        export PATH="$HOME/.local/bin:$PATH"
        if command -v suiup &> /dev/null; then
            log_success "suiup installed"
            SUIUP_AVAILABLE=true
        else
            log_warn "suiup installed but not in PATH. Add to your shell profile:"
            echo '  export PATH="$HOME/.local/bin:$PATH"'
        fi
    fi
fi

# Build MCP server
echo ""
log_info "Building MCP server..."
cd "$PLUGIN_ROOT/mcp/move-lsp-mcp"

if [ ! -d "node_modules" ]; then
    pnpm install
fi

pnpm build
log_success "MCP server built"

# Run tests
echo ""
log_info "Running tests..."
pnpm test 2>&1 | tail -5
log_success "Tests passed"

# Check/Install move-analyzer
echo ""
check_version_match() {
    if command -v sui &> /dev/null && command -v move-analyzer &> /dev/null; then
        SUI_VERSION=$(sui --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        MA_VERSION=$(move-analyzer --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        if [ "$SUI_VERSION" != "$MA_VERSION" ]; then
            log_error "Version mismatch detected!"
            log_error "  sui: $SUI_VERSION"
            log_error "  move-analyzer: $MA_VERSION"
            log_error "This WILL cause LSP crashes. Update both to the same version:"
            echo "  suiup update sui"
            echo "  suiup update move-analyzer"
            echo ""
            read -p "Continue anyway? (NOT recommended) [y/N] " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_error "Setup aborted. Fix version mismatch and run setup again."
                exit 1
            fi
            log_warn "Continuing with mismatched versions (expect LSP errors)"
            return 1
        else
            log_success "Versions match: $SUI_VERSION"
            return 0
        fi
    fi
    return 0
}

if command -v move-analyzer &> /dev/null; then
    MA_PATH=$(which move-analyzer)
    log_success "move-analyzer found at $MA_PATH"

    # Warn if using cargo version instead of suiup
    if [[ "$MA_PATH" == *".cargo"* ]] && [ "$SUIUP_AVAILABLE" = true ]; then
        log_warn "Using cargo-installed move-analyzer (may cause version mismatches)"
        log_warn "Consider using suiup version instead:"
        echo "  mv ~/.cargo/bin/move-analyzer ~/.cargo/bin/move-analyzer.bak"
        echo "  suiup install move-analyzer"
    fi

    check_version_match
else
    if [ "$SUIUP_AVAILABLE" = true ]; then
        log_warn "move-analyzer not found"
        echo ""
        read -p "Install move-analyzer via suiup? [Y/n] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            log_info "Installing move-analyzer..."
            suiup install move-analyzer
            log_success "move-analyzer installed"
            check_version_match
        else
            log_warn "Skipped move-analyzer installation"
            log_warn "LSP tools will return errors until move-analyzer is installed"
            echo ""
            echo "To install later:"
            echo "  suiup install move-analyzer"
        fi
    else
        log_warn "Cannot install move-analyzer without suiup"
        log_warn "LSP tools will return errors until move-analyzer is installed"
        echo ""
        echo "To install suiup:"
        echo "  curl -fsSL https://sui.io/install.sh | sh"
        echo ""
        echo "Then install move-analyzer:"
        echo "  suiup install move-analyzer"
    fi
fi

# Summary
echo ""
echo "========================================"
echo "  Setup Complete"
echo "========================================"
echo ""
log_info "Plugin location: $PLUGIN_ROOT"
log_info "MCP server: $PLUGIN_ROOT/mcp/move-lsp-mcp/dist/index.js"
echo ""

if command -v move-analyzer &> /dev/null; then
    log_success "All LSP features available"
else
    log_warn "LSP features require move-analyzer"
    echo "  Install: suiup install move-analyzer"
fi

echo ""
echo "Next steps:"
echo "  1. Restart Claude Code to load the MCP server"
echo "  2. Try: /sui-pilot or /move-code-quality"
echo ""
