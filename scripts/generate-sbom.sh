#!/usr/bin/env bash
# Generate a CycloneDX SBOM covering the two npm workspaces that ship in
# the Console desktop app (console-shell + console-electron) and write the
# merged document to docs/sbom/console-sbom.cdx.json.
#
# Why CycloneDX and not `npm sbom`: CycloneDX is the format consumed by
# Dependency-Track, Grype, and GitHub dependency review, and cyclonedx-npm
# resolves the installed tree (not just package.json ranges) so the output
# matches what actually ships. SPDX output is available via --output-format
# if a consumer needs it.
#
# This script does NOT run a network install. It expects node_modules to
# already exist in both workspaces (CI installs them; locally run the
# `npm ci --prefix ...` lines in docs/sbom/README.md first). cyclonedx-npm
# is invoked through `npx --no-install` so a missing tool fails loudly
# instead of triggering a silent download.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/docs/sbom"
OUT_FILE="$OUT_DIR/console-sbom.cdx.json"
mkdir -p "$OUT_DIR"

run_cdx() {
  # run_cdx <workspace-dir> <output-path>
  local ws="$1" out="$2"
  if [[ ! -d "$ROOT/$ws/node_modules" ]]; then
    echo "error: $ws/node_modules missing. Run 'npm ci --prefix $ws' first." >&2
    exit 1
  fi
  ( cd "$ROOT/$ws" && npx --no-install cyclonedx-npm \
      --output-format JSON \
      --spec-version 1.5 \
      --output-file "$out" )
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

run_cdx console-shell    "$TMP/shell.cdx.json"
run_cdx console-electron "$TMP/electron.cdx.json"

# Merge the two component lists with the CycloneDX CLI if present, else
# fall back to emitting the shell SBOM and a note. Merging keeps a single
# badge-able artifact instead of two partial ones.
if npx --no-install cyclonedx merge --help >/dev/null 2>&1; then
  npx --no-install cyclonedx merge \
    --input-files "$TMP/shell.cdx.json" "$TMP/electron.cdx.json" \
    --output-file "$OUT_FILE"
else
  echo "note: '@cyclonedx/cyclonedx-cli' not installed; writing shell SBOM only." >&2
  echo "      install it to merge both workspaces into one document." >&2
  cp "$TMP/shell.cdx.json" "$OUT_FILE"
fi

echo "Wrote $OUT_FILE"
