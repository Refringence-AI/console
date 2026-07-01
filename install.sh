#!/usr/bin/env bash
# Console by Refringence - Linux/macOS terminal installer.
#
#   curl -fsSL https://raw.githubusercontent.com/Refringence-AI/console/main/install.sh | bash
#
# Pulls the latest GitHub Release asset for your OS. Free, no package manager,
# no signing required on Linux. macOS needs a notarized build (coming) to run.

set -euo pipefail
repo="Refringence-AI/console"
api="https://api.github.com/repos/${repo}/releases/latest"

echo "Fetching the latest Console release..."
json="$(curl -fsSL "$api")"
asset_url() { echo "$json" | grep -oE 'https://[^"]+' | grep -E "$1" | head -1; }

case "$(uname -s)" in
  Linux)
    dl="$(asset_url '\.AppImage$')"
    [ -n "$dl" ] || { echo "No Linux AppImage on the latest release."; exit 1; }
    dest="${HOME}/.local/bin"
    mkdir -p "$dest"
    echo "Downloading $(basename "$dl")..."
    curl -fsSL "$dl" -o "${dest}/console.AppImage"
    chmod +x "${dest}/console.AppImage"
    echo "Installed to ${dest}/console.AppImage"
    case ":${PATH}:" in
      *":${dest}:"*) echo "Run it with: console.AppImage" ;;
      *) echo "Add ${dest} to your PATH, then run: console.AppImage" ;;
    esac
    ;;
  Darwin)
    echo "macOS builds are not yet code-signed + notarized, so Gatekeeper will"
    echo "block them (the app shows up as 'damaged' on Apple Silicon). A signed"
    echo "build is on the roadmap. Until then, build from source - see the README."
    exit 1
    ;;
  *)
    echo "Unsupported OS: $(uname -s)"
    exit 1
    ;;
esac
