#!/usr/bin/env bash
# Reject new supabase/migrations/*.sql files whose name doesn't start with a
# 14-digit timestamp prefix (YYYYMMDDHHmmss_<name>.sql — the format
# `supabase migration new` produces). Existing 4-digit-prefix files
# (0001_…~0029_…) are grandfathered: only newly-added files are checked.
#
# Why we enforce this:
#   `supabase migration repair` and `db push` key by the file's prefix.
#   When two worktrees both pick `0030_<x>.sql`, the resulting prefix
#   collision can't be registered without manual ledger editing
#   (PROJECT.md §7.9). Timestamp prefixes can't collide at second
#   resolution and require zero coordination between worktrees.
#
# Dual mode:
#   - pre-commit hook: inspects `git diff --cached --diff-filter=A`
#   - CI: inspects `origin/${BASE_REF}...HEAD` so we catch PRs whose
#     authors used --no-verify locally.

set -e

if [ -n "${GITHUB_BASE_REF:-}" ]; then
  # GitHub Actions PR run — compare to the base branch.
  git fetch origin "$GITHUB_BASE_REF" --depth=1 >/dev/null 2>&1 || true
  added=$(git diff --diff-filter=A --name-only "origin/${GITHUB_BASE_REF}...HEAD" \
    | grep -E '^supabase/migrations/.*\.sql$' || true)
elif [ -n "${CI:-}" ]; then
  # Generic CI fallback (push event, etc) — compare to previous commit.
  added=$(git diff --diff-filter=A --name-only HEAD~1...HEAD \
    | grep -E '^supabase/migrations/.*\.sql$' || true)
else
  # Local pre-commit run.
  added=$(git diff --cached --diff-filter=A --name-only \
    | grep -E '^supabase/migrations/.*\.sql$' || true)
fi

if [ -z "$added" ]; then
  exit 0
fi

bad=""
for f in $added; do
  base=$(basename "$f")
  if ! echo "$base" | grep -qE '^[0-9]{14}_'; then
    bad="$bad $f"
  fi
done

if [ -n "$bad" ]; then
  echo "✗ New migrations must use 14-digit timestamp prefix (PROJECT.md §7.9):"
  for f in $bad; do echo "    $f"; done
  echo ""
  echo "  Create with:  pnpm migration:new <name>"
  echo "  Or directly:  supabase migration new <name>"
  echo ""
  echo "  Why: 4-digit prefixes collide between worktrees and can't be"
  echo "  registered via 'supabase migration repair' when duplicates exist."
  echo "  Timestamps are second-resolution and collision-free across workers."
  exit 1
fi
