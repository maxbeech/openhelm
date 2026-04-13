#!/usr/bin/env bash
# e2b/build.sh — Build and publish the OpenHelm Goose sandbox template to E2B.
#
# Prerequisites:
#   - E2B CLI installed: npm install -g @e2b/cli
#   - Authenticated:     e2b auth login
#   - This script run from repo root OR from e2b/ directory
#
# Usage:
#   ./e2b/build.sh           # Build and publish template
#   ./e2b/build.sh --dry-run  # Build only, do not publish
#
# After a successful build:
#   1. Copy the printed Template ID
#   2. Set it as the E2B_TEMPLATE_ID env var in Fly.io secrets:
#        fly secrets set E2B_TEMPLATE_ID=<template-id> --app openhelm-worker
#   3. Update worker/.env.example with the new ID

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
E2B_DIR="$SCRIPT_DIR"

DRY_RUN=false
for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
done

echo "==> OpenHelm E2B sandbox build"
echo "    Repo root:  $REPO_ROOT"
echo "    E2B dir:    $E2B_DIR"

# Check e2b CLI is available
if ! command -v e2b &>/dev/null; then
  echo "ERROR: e2b CLI not found. Install with: npm install -g @e2b/cli" >&2
  exit 1
fi

# Copy MCP servers into the e2b/ build context so Dockerfile can COPY them
echo "==> Copying MCP servers into build context…"
rm -rf "$E2B_DIR/mcp-servers"
cp -r "$REPO_ROOT/agent/mcp-servers" "$E2B_DIR/mcp-servers"
echo "    Copied: agent/mcp-servers/ → e2b/mcp-servers/"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "==> Dry run — skipping e2b template build"
  echo "    Would run: e2b template build  (from $E2B_DIR)"
  exit 0
fi

echo "==> Building E2B template (this may take several minutes)…"
cd "$E2B_DIR"
e2b template build

# Clean up copied MCP servers (they shouldn't be committed)
echo "==> Cleaning up build context…"
rm -rf "$E2B_DIR/mcp-servers"

echo ""
echo "✓ Template built successfully."
echo "  Copy the Template ID above and set it in your Worker config:"
echo ""
echo "  fly secrets set E2B_TEMPLATE_ID=<template-id> --app openhelm-worker"
echo ""
echo "  Also update E2B_TEMPLATE_ID in worker/.env.example for documentation."
