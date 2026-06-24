# Console by Refringence - Windows terminal installer.
#
#   irm https://raw.githubusercontent.com/Refringence-AI/console/main/install.ps1 | iex
#
# Downloads the latest GitHub Release installer and runs it silently to the
# per-user location (no admin needed). Free, no package manager, no signing
# required. The app auto-updates itself after the first install.

$ErrorActionPreference = 'Stop'
$repo = 'Refringence-AI/console'

Write-Host 'Fetching the latest Console release...'
$rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" `
    -Headers @{ 'User-Agent' = 'console-installer' }

$asset = $rel.assets | Where-Object { $_.name -match '\.exe$' } | Select-Object -First 1
if (-not $asset) { throw "No Windows installer (.exe) on release $($rel.tag_name)." }

$out = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)..."
Invoke-WebRequest $asset.browser_download_url -OutFile $out -UseBasicParsing

# Clear the mark-of-the-web so SmartScreen doesn't block the script-run install.
Unblock-File $out

Write-Host 'Installing Console...'
Start-Process -FilePath $out -ArgumentList '/S' -Wait

Write-Host "Console $($rel.tag_name) installed. Open it from the Start menu, or run 'console .' in any repo."
