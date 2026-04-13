#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# scripts/reset-demo.sh <slug>
#
# Re-runs a demo seed migration against the current Supabase project.
# Use this to reset a demo to its pristine seeded state (e.g. before
# a sales demo, or after content drift).
#
# The seed migrations are idempotent — every INSERT has ON CONFLICT
# DO UPDATE or DO NOTHING, so re-running produces the same state.
#
# Usage:
#   scripts/reset-demo.sh nike
#   scripts/reset-demo.sh acme
#
# Requires the Supabase CLI to be installed and authenticated against
# the correct project (supabase link).
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <slug>"
  exit 2
fi

slug="$1"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
seed_file="$repo_root/supabase/migrations/demos/"*_demo_"$slug".sql

# Glob expansion — pick the first match
seed_match=$(ls $seed_file 2>/dev/null | head -n 1 || true)

if [ -z "$seed_match" ]; then
  echo "✗ No seed file found for slug '$slug' under supabase/migrations/demos/"
  exit 1
fi

echo "→ Resetting demo '$slug' from $seed_match"
supabase db execute --file "$seed_match"
echo "✓ Demo '$slug' reset complete"
