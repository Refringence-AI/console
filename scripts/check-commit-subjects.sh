#!/usr/bin/env bash
# Validate that every commit subject in the PR range follows Conventional
# Commits: type(area): subject. Run by the commit-lint job in
# .github/workflows/quality.yml, which sets BASE_SHA and HEAD_SHA from the
# pull_request event payload.
#
# Accepted types match CONTRIBUTING.md plus the CI-relevant extras.
# The `auto(...)` prefix used by automated commits is allowed too.
set -euo pipefail

BASE_SHA="${BASE_SHA:?BASE_SHA not set}"
HEAD_SHA="${HEAD_SHA:?HEAD_SHA not set}"

# type(area): subject
#   type  = one of the allowed types
#   (area)= optional scope in parentheses
#   !     = optional breaking-change marker
#   then ': ' and a non-empty subject
PATTERN='^(feat|fix|chore|docs|refactor|test|build|ci|perf|auto)(\([a-z0-9._-]+\))?!?: .+'

fail=0
while IFS= read -r sha; do
  [[ -z "$sha" ]] && continue
  subject=$(git log -1 --format='%s' "$sha")

  # Skip merge commits: they are generated, not authored.
  if [[ "$subject" == Merge\ * ]]; then
    continue
  fi

  if ! printf '%s' "$subject" | grep -qP "$PATTERN"; then
    echo "::error::non-conventional commit subject: ${sha:0:8} \"$subject\""
    fail=1
  fi
done < <(git rev-list "$BASE_SHA..$HEAD_SHA")

if [[ "$fail" -ne 0 ]]; then
  echo ""
  echo "Commit-lint failed. Use 'type(area): subject', for example"
  echo "  feat(evals): add promptfoo cost column"
  echo "Allowed types: feat fix chore docs refactor test build ci perf."
  exit 1
fi

echo "Commit-lint passed."
