#!/usr/bin/env bash
# Fail if newly added content contains an em-dash (U+2014) or a banned
# marketing word. Run by .github/workflows/quality.yml and usable locally.
#
# Two modes:
#   check-banned-content.sh --range <base> <head> [files...]
#       Ratchet mode (CI). Scans only the lines ADDED between base and head.
#       Pre-existing copy across the repo is grandfathered, so touching a file
#       that already contains an em-dash does not fail the build; only new
#       em-dashes / banned words do. This matches the documented intent and is
#       why a 65-commit first push does not demand a one-shot tree-wide cleanup.
#   check-banned-content.sh [files...]
#       Audit mode. Scans full file contents (whole tree if no files given).
#       Reports every occurrence, pre-existing included, for a manual sweep.
#
# Why a script and not inline YAML: the banned list must live in exactly one
# place, and that place has to be exempt from its own check. Keeping it here
# lets us exclude this file (and the workflow) by path instead of smuggling the
# words past a regex.
set -euo pipefail

# grep -P (PCRE) refuses to run under a non-UTF-8 locale and would then error
# out instead of matching, which silently passes the check. Pin a UTF-8 locale
# so em-dash and word-boundary matching are deterministic on every runner.
# C.UTF-8 is present on ubuntu-latest and Git Bash alike.
export LC_ALL=C.UTF-8

# Banned marketing words. Matched case-insensitively with word boundaries so
# legitimate substrings do not false-positive.
BANNED_WORDS=(
  'powerful'
  'robust'
  'comprehensive'
  'seamless'
  'leverage'
  'actionable'
  'AI-powered'
  'next-generation'
)
BANNED_PHRASE='gain insights'

# Files exempt from the scan because they legitimately contain the banned
# tokens as data: the script that defines the rule, the workflow that calls it,
# and any CLAUDE.md / CONTRIBUTING.md (package-level included) that quotes the
# list verbatim so contributors know what is banned.
EXEMPT_PATHS=(
  'scripts/check-banned-content.sh'
  '.github/workflows/quality.yml'
)
is_exempt() {
  local f="$1"
  for ex in "${EXEMPT_PATHS[@]}"; do
    [[ "$f" == "$ex" ]] && return 0
  done
  case "$(basename "$f")" in
    CLAUDE.md|CONTRIBUTING.md) return 0 ;;
    # Vendored agent-skill docs (.claude/skills/*/SKILL.md) are upstream
    # third-party text we copy verbatim; they legitimately contain em-dashes.
    SKILL.md) return 0 ;;
  esac
  return 1
}

# Mode parse. --range turns on the added-lines ratchet.
RANGE=0
BASE=""
HEAD=""
if [[ "${1:-}" == "--range" ]]; then
  RANGE=1
  BASE="${2:?--range needs a base sha}"
  HEAD="${3:?--range needs a head sha}"
  shift 3
fi

# Candidate files. With file args we scan only those; without, the whole
# tracked tree (audit mode only).
if [[ "$#" -gt 0 ]]; then
  CANDIDATES=("$@")
else
  mapfile -t CANDIDATES < <(git ls-files)
fi

# Exclude binary/lock/generated paths that either cannot contain prose or are
# not human-authored copy.
FILES=()
for c in "${CANDIDATES[@]}"; do
  case "$c" in
    node_modules/*|*/node_modules/*) continue ;;
    dist/*|*/dist/*|build/*|*/build/*) continue ;;
    package-lock.json|*/package-lock.json) continue ;;
    CHANGELOG.md|*/CHANGELOG.md|CHANGELOG|*/CHANGELOG) continue ;;
  esac
  case "$c" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.svg|*.ico|*.woff|*.woff2|*.ttf|*.eot|*.pdf|*.lock) continue ;;
  esac
  FILES+=("$c")
done

fail=0
report() {
  # report <file> <label> <grep-output>
  echo "::error file=$1::banned content ($2) in $1"
  echo "---- $1 ($2) ----"
  echo "$3"
  fail=1
}

# Word-boundary regex for the single words. \b works in GNU grep -P; we use -P
# (PCRE) so the alternation and boundaries behave predictably.
WORD_REGEX="\\b($(IFS='|'; echo "${BANNED_WORDS[*]}"))\\b"

# content_of <file>: the bytes to scan. In ratchet mode that is just the lines
# added in the range (diff '+' lines, minus the '+++' header, with the leading
# '+' stripped); in audit mode it is the whole file.
content_of() {
  local f="$1"
  if [[ "$RANGE" -eq 1 ]]; then
    # A file with no added lines (pure deletion, e.g. removing a .gitignore
    # entry) makes the grep pipe exit non-zero; the trailing `|| true` keeps
    # that from aborting the script under `set -e -o pipefail`.
    git diff "$BASE" "$HEAD" -- "$f" | grep -E '^\+' | grep -vE '^\+\+\+' | sed 's/^\+//' || true
  else
    cat -- "$f"
  fi
}

if [[ "${#FILES[@]}" -eq 0 ]]; then
  echo "Banned-content check: no in-scope files."
  exit 0
fi

for f in "${FILES[@]}"; do
  is_exempt "$f" && continue
  # In audit mode the file must exist; in ratchet mode a deleted file just
  # yields no added lines.
  if [[ "$RANGE" -eq 0 && ! -f "$f" ]]; then continue; fi

  content="$(content_of "$f")"
  [[ -z "$content" ]] && continue

  # scan <label> <grep-args...>: grep exit 0 = match (report), 1 = clean,
  # 2+ = grep itself errored (bad locale, etc.) which we treat as fatal so the
  # check never silently passes on a broken runner.
  scan() {
    local label="$1"; shift
    local out rc
    set +e
    out=$(printf '%s\n' "$content" | grep "$@")
    rc=$?
    set -e
    case "$rc" in
      0) report "$f" "$label" "$out" ;;
      1) : ;;
      *) echo "::error file=$f::grep failed (exit $rc) scanning for $label"; exit 2 ;;
    esac
  }

  scan "em-dash U+2014" -nP '\x{2014}'
  scan "banned word"    -niP "$WORD_REGEX"
  scan "banned phrase"  -niP "\\b${BANNED_PHRASE}\\b"
done

if [[ "$fail" -ne 0 ]]; then
  echo ""
  echo "Banned-content check failed. Remove the em-dashes and marketing words"
  echo "flagged above (newly added lines only in CI). Rules live in CLAUDE.md;"
  echo "the list lives in scripts/check-banned-content.sh."
  exit 1
fi

echo "Banned-content check passed."
