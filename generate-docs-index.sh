#!/usr/bin/env bash
# generate-docs-index.sh — DEPRECATED in v2
#
# The pipe-delimited doc index that this script used to maintain inside
# agents/sui-pilot-agent.md was removed in the v2 graph-port. The agent now
# uses Glob/Grep against the bundled .<source>-docs/ corpora directly,
# routed by a small topic table at the top of agents/sui-pilot-agent.md.
#
# This stub remains so existing docs/CI/cron references print a clear
# explanation instead of failing with "command not found".

cat <<'EOF'
generate-docs-index.sh: deprecated in sui-pilot v2.

The pipe-delimited <!-- AGENTS-MD-START --> / <!-- AGENTS-MD-END --> block
in agents/sui-pilot-agent.md is gone. v2 routes by topic table and lets the
agent navigate the .<source>-docs/ corpora directly via Glob/Grep, so there
is no precomputed index to regenerate.

Nothing to do — exiting 0.
EOF

exit 0
