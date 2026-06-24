#!/usr/bin/env pwsh
# scripts/launch-console.ps1
#
# Launch Console in a clean env that strips
# ELECTRON_RUN_AS_NODE.
#
# Why this exists:
#   Some dev shells (Cursor, Antigravity IDE, certain WSL bash setups)
#   inherit ELECTRON_RUN_AS_NODE=1 from a parent process. When set,
#   electron loads main.js in Node-only mode and `app` is undefined,
#   crashing immediately:
#
#     TypeError: Cannot read properties of undefined (reading 'setName')
#       at electron_1.app.setName('Console')
#
#   This script unsets the var BEFORE spawning electron, sidestepping
#   the trap.
#
# Usage:
#   pwsh scripts/launch-console.ps1            # production-style launch
#   pwsh scripts/launch-console.ps1 -Dev       # dev mode, points at Vite 5174
#   pwsh scripts/launch-console.ps1 -Build     # rebuild + launch
param(
    [switch]$Dev,
    [switch]$Build
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$consoleElectron = Join-Path $repo "console-electron"

# THE FIX — strip the trap env var before electron sees it.
Remove-Item env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

if ($Build) {
    Write-Host "Building console-shell + console-electron..."
    Push-Location (Join-Path $repo "console-shell")
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "console-shell build failed" }
    Pop-Location
    Push-Location $consoleElectron
    npm run build:main
    if ($LASTEXITCODE -ne 0) { throw "console-electron build:main failed" }
    Pop-Location
}

if ($Dev) {
    $env:REFRINGENCE_CONSOLE_DEV = "1"
    $env:REFRINGENCE_CONSOLE_RENDERER_URL = "http://localhost:5174"
    Write-Host "Launching Console in DEV mode (renderer @ http://localhost:5174)..."
} else {
    Remove-Item env:REFRINGENCE_CONSOLE_DEV -ErrorAction SilentlyContinue
    Write-Host "Launching Console..."
}

$electronExe = Join-Path $consoleElectron "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    throw "Electron binary missing at $electronExe. Run ``npm install`` in console-electron/ first."
}

& $electronExe $consoleElectron
